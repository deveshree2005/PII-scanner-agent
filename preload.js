
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piiScanner", {
  // File Scanner
  selectFiles: () => ipcRenderer.invoke("select-files"),

  selectFolder: () => ipcRenderer.invoke("select-folder"),
  
  listDrives: () => ipcRenderer.invoke("list-drives"),

  collectDriveFiles: (drivePath) =>
    ipcRenderer.invoke("collect-drive-files", drivePath),

  scanFiles: (filePaths, piiType = "all") =>
    ipcRenderer.invoke("scan-files", filePaths, piiType),

  // Admin Panel: People
  listPeople: (searchTerm = "") =>
    ipcRenderer.invoke("people:list", searchTerm),

  addPerson: (person) =>
    ipcRenderer.invoke("people:add", person),

  getPerson: (id) =>
    ipcRenderer.invoke("people:get", id),

  updatePerson: (id, person) =>
    ipcRenderer.invoke("people:update", id, person),

  deletePerson: (id) =>
    ipcRenderer.invoke("people:delete", id),

  // Audit Logs
  listAuditLogs: (limit = 100) =>
    ipcRenderer.invoke("audit:list", limit),

  // Custom Detection Rules
  listDetectionRules: () =>
    ipcRenderer.invoke("rules:list"),

  addDetectionRule: (rule) =>
    ipcRenderer.invoke("rules:add", rule),

  updateDetectionRule: (id, rule) =>
    ipcRenderer.invoke("rules:update", id, rule),

  toggleDetectionRule: (id, enabled) =>
    ipcRenderer.invoke("rules:toggle", id, enabled),

  deleteDetectionRule: (id) =>
    ipcRenderer.invoke("rules:delete", id)
});
