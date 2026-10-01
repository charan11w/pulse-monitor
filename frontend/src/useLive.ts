import { useEffect, useState } from "react";
import { io } from "socket.io-client";
export function useLive(
  projectId: string,
  enabled: boolean,
  refresh: () => void,
  checkSession: () => void,
) {
  const [state, setState] = useState("Offline");
  useEffect(() => {
    if (!enabled || !projectId) {
      setState("Offline");
      return;
    }
    setState("Connecting");
    // Browser WebSocket handshakes always carry Origin, including same-origin use.
    const socket = io({ withCredentials: true, transports: ["websocket"] });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          refresh();
        }, 1000);
    };
    socket.on("connect", () => {
      socket.emit("subscribe", projectId, (result: { ok: boolean }) => {
        if (result.ok) {
          setState("Live");
          schedule();
        } else {
          setState("Access denied");
          checkSession();
        }
      });
    });
    socket.on("metrics:changed", (data: { projectId: string }) => {
      if (data.projectId === projectId) schedule();
    });
    socket.on("disconnect", (reason) => {
      setState("Reconnecting");
      if (reason === "io server disconnect") {
        setState("Session ended");
        checkSession();
      }
    });
    socket.on("connect_error", () => {
      setState("Offline · manual refresh available");
      checkSession();
    });
    return () => {
      if (timer) clearTimeout(timer);
      socket.disconnect();
    };
  }, [projectId, enabled, refresh, checkSession]);
  return state;
}
