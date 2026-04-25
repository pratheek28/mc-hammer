"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate,
  runApprovedCommand: () => runApprovedCommand
});
module.exports = __toCommonJS(extension_exports);
var vscode = __toESM(require("vscode"));
var path = __toESM(require("path"));
var hammerTerminal;
var reactTerminal;
var socket = new WebSocket("ws://127.0.0.1:8765");
function getTerminal() {
  if (!hammerTerminal || hammerTerminal.exitStatus !== void 0) {
    hammerTerminal = vscode.window.createTerminal("MC Hammer");
  }
  return hammerTerminal;
}
function sendToBackend(data) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  } else {
    socket.addEventListener("open", () => socket.send(data), { once: true });
  }
}
function startReactAndPreview(context) {
  if (!reactTerminal || reactTerminal.exitStatus !== void 0) {
    const dependencyGraphUIPath = path.join(context.extensionPath, "dependency-graph-ui");
    reactTerminal = vscode.window.createTerminal({
      name: "Dependency Graph UI",
      cwd: dependencyGraphUIPath
    });
    reactTerminal.sendText("npm run dev");
  }
  setTimeout(() => {
    vscode.commands.executeCommand(
      "simpleBrowser.show",
      "http://localhost:5173"
    );
  }, 4e3);
}
async function runApprovedCommand(command, context) {
  const result = await vscode.window.showInformationMessage(
    `MC Hammer wants to run: ${command}`,
    { modal: true },
    "Run it",
    "Reject"
  );
  if (result === "Run it") {
    const terminal = getTerminal();
    terminal.show();
    terminal.sendText(command);
    const dir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (dir) {
      vscode.env.clipboard.writeText(dir);
      vscode.window.showInformationMessage(`Copied dir: ${dir}`);
      sendToBackend(dir);
      vscode.window.showInformationMessage("Sent directory to backend!");
      startReactAndPreview(context);
    } else {
      vscode.window.showInformationMessage("Failed");
    }
    return "ran";
  }
  if (result === "Reject") {
    return "rejected";
  }
  return "dismissed";
}
function activate(context) {
  console.log('Congratulations, your extension "mc-hammer" is now active!');
  const disposable = vscode.commands.registerCommand("mc-hammer.helloWorld", () => {
    vscode.window.showInformationMessage("Hello people from mc-hammer!");
  });
  const overlayRunCommand = vscode.commands.registerCommand("mc-hammer.overlayRunWhichPython3", async () => {
    await runApprovedCommand("which python3", context);
  });
  const overlayButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1e3);
  overlayButton.text = "MC HAMMER: HAMMER TIME\u{1F528}";
  overlayButton.tooltip = "Run approved command: which python3";
  overlayButton.command = "mc-hammer.overlayRunWhichPython3";
  overlayButton.show();
  context.subscriptions.push(disposable, overlayRunCommand, overlayButton);
}
function deactivate() {
  hammerTerminal?.dispose();
  reactTerminal?.dispose();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate,
  runApprovedCommand
});
//# sourceMappingURL=extension.js.map
