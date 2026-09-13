/** A new workspace is always a named child, never the selected parent folder. */
export function workspaceCreationPath(name: string, location: string, managed: boolean) {
  const folder = name.trim();
  if (!folder || folder === "." || folder === ".." || /[<>:"/\\|?*]/.test(folder)
    || Array.from(folder).some((character) => character.charCodeAt(0) < 32)
    || /[. ]$/.test(folder) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(folder)) {
    throw new Error("Use a workspace name without slashes, special characters, or reserved folder names.");
  }
  if (managed) return folder;
  if (!location || !(/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(location))) {
    throw new Error("Choose a location for your workspace.");
  }
  const separator = location.includes("\\") ? "\\" : "/";
  return `${location.replace(/[\\/]+$/, "")}${separator}${folder}`;
}
