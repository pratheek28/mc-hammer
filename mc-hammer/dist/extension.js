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
var vscode2 = __toESM(require("vscode"));
var cp = __toESM(require("child_process"));
var path = __toESM(require("path"));

// src/conflictPetView.ts
var vscode = __toESM(require("vscode"));
var ConflictPetViewProvider = class {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
  }
  extensionUri;
  static viewType = "mc-hammer.conflictPetView";
  _view;
  _hasConflict = false;
  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview, this._hasConflict);
  }
  setConflictState(hasConflict) {
    this._hasConflict = hasConflict;
    if (!this._view) {
      return;
    }
    this._view.webview.html = this.getHtml(this._view.webview, hasConflict);
  }
  getHtml(webview, hasConflict) {
    const gifPath = hasConflict ? "ralph.gif" : "felix.gif";
    const gifUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", gifPath)
    );
    const label = hasConflict ? "Merge conflict detected" : "No merge conflict";
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
        body {
            margin: 0;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: center;
            justify-content: center;
            background: transparent;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
        }
        .pet {
            width: min(100%, 220px);
            height: auto;
            object-fit: contain;
            border-radius: 8px;
        }
        .status {
            font-size: 12px;
            opacity: 0.9;
            text-align: center;
        }
    </style>
</head>
<body>
    <img class="pet" src="${gifUri}" alt="${label}" />
    <div class="status">${hasConflict ? "$(warning) Merge Conflict Detected" : "$(check) No Merge Conflicts"}</div>
</body>
</html>`;
  }
};

// src/extension.ts
var hammerTerminal;
var reactTerminal;
var socket = new WebSocket("ws://127.0.0.1:8765");
function getTerminal() {
  if (!hammerTerminal || hammerTerminal.exitStatus !== void 0) {
    hammerTerminal = vscode2.window.createTerminal("MC Hammer");
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
async function getConflictedFunctions() {
  const workspaceFolders = vscode2.workspace.workspaceFolders;
  console.log("[MC Hammer] workspaceFolders:", workspaceFolders?.map((f) => f.uri.fsPath));
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode2.window.showErrorMessage("MC Hammer: No workspace folder is open.");
    return {};
  }
  const cwd = workspaceFolders[0].uri.fsPath;
  console.log("[MC Hammer] cwd:", cwd);
  const result = {};
  return new Promise((resolve) => {
    cp.exec("git diff --name-only --diff-filter=U", { cwd }, async (err, stdout) => {
      console.log("[MC Hammer] git diff err:", err);
      console.log("[MC Hammer] git diff stdout:", stdout);
      if (err || !stdout.trim()) {
        console.log("[MC Hammer] early exit - no conflicts or git error");
        resolve(result);
        return;
      }
      const conflictedFiles = stdout.trim().split("\n").filter((f) => f.endsWith(".py"));
      console.log("[MC Hammer] conflicted python files:", conflictedFiles);
      for (const filePath of conflictedFiles) {
        const fullPath = `${cwd}/${filePath}`;
        console.log("[MC Hammer] scanning file:", fullPath);
        const doc = await vscode2.workspace.openTextDocument(fullPath);
        const lines = doc.getText().split("\n");
        const functions = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith("<<<<<<<")) {
            console.log("[MC Hammer] conflict marker found at line", i);
            for (let j = i; j >= 0; j--) {
              if (lines[j].trimStart().startsWith("def ")) {
                const funcName = lines[j].trim().split("(")[0].replace("def ", "");
                console.log("[MC Hammer] enclosing function found:", funcName);
                if (!functions.includes(funcName)) {
                  functions.push(funcName);
                }
                break;
              }
            }
          }
        }
        console.log("[MC Hammer] functions with conflicts in", filePath, ":", functions);
        if (functions.length > 0) {
          result[filePath] = functions;
        }
      }
      console.log("[MC Hammer] final result:", JSON.stringify(result, null, 2));
      resolve(result);
    });
  });
}
function startReactAndPreview(context) {
  if (!reactTerminal || reactTerminal.exitStatus !== void 0) {
    const dependencyGraphUIPath = path.join(context.extensionPath, "dependency-graph-ui");
    reactTerminal = vscode2.window.createTerminal({
      name: "Dependency Graph UI",
      cwd: dependencyGraphUIPath
    });
    reactTerminal.sendText("npm run dev");
  }
  setTimeout(() => {
    vscode2.commands.executeCommand("simpleBrowser.show", "http://localhost:5173");
  }, 4e3);
}
async function runApprovedCommand(command, context) {
  const result = await vscode2.window.showInformationMessage(
    `MC Hammer wants to run: ${command}`,
    { modal: true },
    "Run it",
    "Reject"
  );
  if (result === "Run it") {
    const terminal = getTerminal();
    terminal.show();
    terminal.sendText(command);
    const dir = vscode2.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (dir) {
      vscode2.env.clipboard.writeText(dir);
      vscode2.window.showInformationMessage(`Copied dir: ${dir}`);
      sendToBackend(dir);
      vscode2.window.showInformationMessage("Sent directory to backend!");
      startReactAndPreview(context);
    } else {
      vscode2.window.showInformationMessage("Failed");
    }
    return "ran";
  }
  if (result === "Reject") {
    return "rejected";
  }
  return "dismissed";
}
async function buttonClicked(conflictStatusBar, conflictPetViewProvider) {
  const terminal = getTerminal();
  terminal.show();
  terminal.sendText("git diff --name-only --diff-filter=U");
  const conflictedFunctions = await getConflictedFunctions();
  if (Object.keys(conflictedFunctions).length === 0) {
    conflictStatusBar.color = new vscode2.ThemeColor("statusBar.debuggingForeground");
    conflictStatusBar.text = "$(check) \u{1F528} No Merge Conflicts";
    conflictStatusBar.backgroundColor = void 0;
    vscode2.window.showInformationMessage("No merge conflicts detected in Python files.");
    conflictPetViewProvider.setConflictState(false);
    return;
  }
  conflictStatusBar.text = "$(warning) \u{1F528} Merge Conflict Detected";
  conflictPetViewProvider.setConflictState(true);
  conflictStatusBar.backgroundColor = new vscode2.ThemeColor("statusBarItem.errorBackground");
  vscode2.window.showInformationMessage(
    `MC Hammer found conflicts in: ${Object.keys(conflictedFunctions).join(", ")}`
  );
  sendToBackend(JSON.stringify(conflictedFunctions));
}
function activate(context) {
  console.log('Congratulations, your extension "mc-hammer" is now active!');
  const conflictStatusBar = vscode2.window.createStatusBarItem(
    vscode2.StatusBarAlignment.Left,
    100
  );
  conflictStatusBar.text = "$(check) \u{1F528} No Merge Conflicts";
  conflictStatusBar.backgroundColor = void 0;
  conflictStatusBar.command = "mc-hammer.buttonClicked";
  conflictStatusBar.tooltip = "Click to run MC Hammer on merge conflicts";
  conflictStatusBar.show();
  context.subscriptions.push(conflictStatusBar);
  const conflictPetViewProvider = new ConflictPetViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode2.window.registerWebviewViewProvider(
      ConflictPetViewProvider.viewType,
      conflictPetViewProvider
    )
  );
  conflictPetViewProvider.setConflictState(false);
  const watcher = vscode2.workspace.createFileSystemWatcher("**/*.py");
  watcher.onDidChange(async (uri) => {
    const doc = await vscode2.workspace.openTextDocument(uri);
    if (doc.getText().includes("<<<<<<<")) {
      conflictStatusBar.text = "$(warning) \u{1F528} Merge Conflict Detected";
      conflictStatusBar.backgroundColor = new vscode2.ThemeColor("statusBarItem.errorBackground");
      conflictPetViewProvider.setConflictState(true);
      vscode2.window.showInformationMessage(
        `MC Hammer detected a merge conflict in ${uri.fsPath}`
      );
    }
  });
  context.subscriptions.push(watcher);
  context.subscriptions.push(
    vscode2.commands.registerCommand("mc-hammer.helloWorld", () => {
      vscode2.window.showInformationMessage("Hello! from mc-hammer!");
    })
  );
  context.subscriptions.push(
    vscode2.commands.registerCommand("mc-hammer.buttonClicked", () => {
      buttonClicked(conflictStatusBar, conflictPetViewProvider).catch((err) => {
        vscode2.window.showErrorMessage(`MC Hammer error: ${err.message}`);
      });
    })
  );
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
