import { create } from "zustand";

/** Global CRM dialogs, openable from any page (top bar, tables, dashboards) */
interface CrmUiState {
  leadId: string | null;
  /** What the lead was opened from, when closing it should go back there (e.g. "Kavita Nunwal's day") */
  leadBackTo: string | null;
  inquiryOpen: boolean;
  openLead: (id: string, backTo?: string) => void;
  closeLead: () => void;
  openInquiry: () => void;
  closeInquiry: () => void;
}

export const useCrmUi = create<CrmUiState>((set) => ({
  leadId: null,
  leadBackTo: null,
  inquiryOpen: false,
  openLead: (id, backTo) => set({ leadId: id, leadBackTo: backTo ?? null }),
  closeLead: () => set({ leadId: null, leadBackTo: null }),
  openInquiry: () => set({ inquiryOpen: true }),
  closeInquiry: () => set({ inquiryOpen: false }),
}));
