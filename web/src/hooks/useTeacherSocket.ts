"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type {
  CanvasToIdeMessage,
  GitDiffPayload,
  GitRefsPayload,
  IdeStateChangedPayload,
  LocalServicesDiscoveredPayload,
  SourceFilesChangedPayload,
} from "@core/protocol";
import type { ProjectMap } from "@core/projectMap";
import {
  TeacherSocketManager,
  type ConnectionStatus,
} from "@/lib/ws/TeacherSocketManager";

const DEFAULT_WS_URL = "ws://127.0.0.1:8080";

let manager: TeacherSocketManager | null = null;

function getManager(): TeacherSocketManager {
  if (!manager) {
    manager = new TeacherSocketManager(
      process.env.NEXT_PUBLIC_TEACHER_WS_URL ?? DEFAULT_WS_URL,
    );
  }
  return manager;
}

function subscribe(listener: () => void): () => void {
  return getManager().subscribe(listener);
}

function getStatusSnapshot(): ConnectionStatus {
  return getManager().getSnapshot().status;
}

function getIdeStateSnapshot(): IdeStateChangedPayload | null {
  return getManager().getSnapshot().ideState;
}

function getServerStatus(): ConnectionStatus {
  return "closed";
}

function getServerIdeState(): IdeStateChangedPayload | null {
  return null;
}

export function sendTeacherMessage(msg: CanvasToIdeMessage): boolean {
  return getManager().send(msg);
}

export function fetchGitRefs(): Promise<GitRefsPayload> {
  return getManager().requestGitRefs();
}

export function fetchGitDiff(base: string, head: string | null): Promise<GitDiffPayload> {
  return getManager().requestGitDiff(base, head);
}

/** Pide a la extensión un sondeo de servicios locales; false si el IDE no está conectado. */
export function requestLocalServices(): boolean {
  return getManager().requestLocalServices();
}

/** Suscripción (fuera de React) a los servicios locales que anuncia la extensión. */
export function subscribeLocalServices(listener: (result: LocalServicesDiscoveredPayload) => void): () => void {
  return getManager().subscribeLocalServices(listener);
}

export function fetchProjectMap(): Promise<ProjectMap> {
  return getManager().requestProjectMap();
}

export function useTeacherConnection(): void {
  useEffect(() => {
    let started = false;
    const id = window.setTimeout(() => {
      started = true;
      getManager().connect();
    }, 0);
    return () => {
      window.clearTimeout(id);
      if (started) {
        getManager().disconnect();
      }
    };
  }, []);
}

export function useTeacherStatus(): ConnectionStatus {
  return useSyncExternalStore(subscribe, getStatusSnapshot, getServerStatus);
}

export function useTeacherCommand(): {
  status: ConnectionStatus;
  send: (msg: CanvasToIdeMessage) => boolean;
} {
  const status = useSyncExternalStore(subscribe, getStatusSnapshot, getServerStatus);
  return { status, send: sendTeacherMessage };
}

export function useTeacherIdeState(): IdeStateChangedPayload | null {
  return useSyncExternalStore(subscribe, getIdeStateSnapshot, getServerIdeState);
}

export function useTeacherSocket(): {
  status: ConnectionStatus;
  ideState: IdeStateChangedPayload | null;
  send: (msg: CanvasToIdeMessage) => boolean;
} {
  const status = useSyncExternalStore(subscribe, getStatusSnapshot, getServerStatus);
  const ideState = useSyncExternalStore(subscribe, getIdeStateSnapshot, getServerIdeState);
  return { status, ideState, send: sendTeacherMessage };
}

/** Llama a `onChange` cada vez que el IDE avisa de archivos fuente creados, modificados o borrados. */
export function useSourceFilesChanged(onChange: (change: SourceFilesChangedPayload) => void): void {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => getManager().subscribeSourceChanges((change) => latest.current(change)), []);
}
