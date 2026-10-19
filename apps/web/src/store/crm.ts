import { create } from "zustand";

/** Global CRM dialogs, openable from any page (top bar, tables, dashboards) */
interface CrmUiState {
  leadId: string | null;
  inquiryOpen: boolean;
  openLead: (id: string) => void;
  closeLead: () => void;
  openInquiry: () => void;
  closeInquiry: () => void;
}

export const useCrmUi = create<CrmUiState>((set) => ({
  leadId: null,
  inquiryOpen: false,
  openLead: (id) => set({ leadId: id }),
  closeLead: () => set({ leadId: null }),
  openInquiry: () => set({ inquiryOpen: true }),
  closeInquiry: () => set({ inquiryOpen: false }),
}));
