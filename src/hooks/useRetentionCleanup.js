import { useEffect } from "react";
import { runRetentionCleanup } from "../services/storageService.js";

export function useRetentionCleanup() {
  useEffect(() => {
    runRetentionCleanup().then((purged) => console.log(`Purged ${purged} screenshots`));
  }, []);
}
