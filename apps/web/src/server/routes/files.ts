import { Router } from 'express';
import multer from 'multer';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import { files } from '../db/schema';
import { createFile, saveUpload, uploadKey } from '../services/fileService';
import { MAX_UPLOAD_BYTES, deleteObject, getObject } from '../lib/storage';
import { authMiddleware, requireRole, AuthRequest } from '../lib/auth';
import { optionalId, sendError, uuidParam } from '../lib/http';
import { inClientProjects, pick } from '../lib/scopes';
import { toApi } from '../lib/serialize';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|xls|xlsx|mp4|webm|mov)$/i.test(file.originalname) ||
      file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') || file.mimetype === 'application/pdf';
    cb(null, !!allowed);
  },
});

const detailRelations = { uploader: pick.userName, project: pick.projectName, task: pick.taskTitle } as const;

router.get('/serve/:key', async (req, res) => {
  try {
    // uploadKey() keeps only the file name, so "..%2F" can't reach outside the uploads folder
    const key = req.params.key as string;
    const [row] = await db.select({ mimeType: files.mimeType, filename: files.filename }).from(files).where(eq(files.storageKey, key)).limit(1);
    const stored = await getObject(uploadKey(key));
    if (!stored) return res.status(404).json({ message: 'File not found' });
    res.set({
      'Content-Type': row?.mimeType || stored.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
      ...(row?.filename && { 'Content-Disposition': `inline; filename="${row.filename.replace(/[^\w.\- ]+/g, '_')}"` }),
    });
    stored.stream.pipe(res);
  } catch (err) {
    sendError(res, err, 'Failed to load file');
  }
});

router.get('/', async (req: AuthRequest, res) => {
  try {
    const conditions: SQL[] = [];
    const projectId = optionalId(req.query.projectId, 'projectId');
    const taskId = optionalId(req.query.taskId, 'taskId');
    if (projectId) conditions.push(eq(files.projectId, projectId));
    if (taskId) conditions.push(eq(files.taskId, taskId));
    if (req.user?.role === 'CLIENT') {
      conditions.push(inClientProjects(files.projectId, req.user.clientId));
    }

    const rows = await db.query.files.findMany({
      where: and(...conditions),
      with: { uploader: pick.userName },
      orderBy: [desc(files.createdAt)],
    });
    res.json(toApi(rows));
  } catch (err) {
    sendError(res, err, 'Failed to fetch files');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const file = await db.query.files.findFirst({ where: eq(files.id, req.params.id as string), with: detailRelations });
    if (!file) return res.status(404).json({ message: 'File not found' });
    res.json(toApi(file));
  } catch (err) {
    sendError(res, err, 'Failed to fetch file');
  }
});

router.get('/:id/versions', async (req, res) => {
  try {
    const [file] = await db.select({ versions: files.versions }).from(files).where(eq(files.id, req.params.id as string)).limit(1);
    if (!file) return res.status(404).json({ message: 'File not found' });
    res.json(file.versions || []);
  } catch (err) {
    sendError(res, err, 'Failed to fetch versions');
  }
});

router.post('/upload', requireRole('SUPER_ADMIN', 'TEAM_MEMBER', 'CLIENT'), upload.single('file'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const projectId = optionalId(req.body?.projectId, 'projectId');
    const taskId = optionalId(req.body?.taskId, 'taskId');

    const { url, storageKey } = await saveUpload(req.file.buffer, req.file.originalname, req.file.mimetype);

    const { id } = await createFile({
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      url,
      storageKey,
      projectId,
      taskId,
      uploadedBy: authReq.user!.id,
    });

    const file = await db.query.files.findFirst({ where: eq(files.id, id), with: detailRelations });
    res.status(201).json(toApi(file!));
  } catch (err) {
    sendError(res, err, 'Upload failed');
  }
});

router.delete('/:id', requireRole('SUPER_ADMIN', 'TEAM_MEMBER'), async (req, res) => {
  try {
    const [file] = await db
      .delete(files)
      .where(eq(files.id, req.params.id as string))
      .returning({ storageKey: files.storageKey });
    if (!file) return res.status(404).json({ message: 'File not found' });
    await deleteObject(uploadKey(file.storageKey)).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete file');
  }
});

export default router;
