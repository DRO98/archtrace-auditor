import type { ReactNode } from "react";
import { Suspense } from "react";
import { IDESetupModal } from "@/features/canvas/components/IDESetupModal";
import { AiVaultBootstrap } from "@/features/dashboard/AiVaultBootstrap";
import { GlobalSidebar } from "@/features/dashboard/GlobalSidebar";
import { TeacherConnection } from "@/features/dashboard/TeacherConnection";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh bg-app text-ink">
      <Suspense fallback={<aside className="theme-light w-14 shrink-0 border-r border-edge bg-panel" aria-hidden />}>
        <GlobalSidebar />
      </Suspense>
      <div className="min-w-0 flex-1">{children}</div>
      <TeacherConnection />
      <IDESetupModal />
      <AiVaultBootstrap />
    </div>
  );
}
