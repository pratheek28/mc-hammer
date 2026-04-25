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
var import_fs = require("fs");

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
    const petClass = hasConflict ? "pet" : "pet pet-felix";
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
        }
        .pet-felix {
            width: min(100%, 340px);
        }
        .status {
            font-size: 12px;
            opacity: 0.9;
            text-align: center;
        }
    </style>
</head>
<body>
    <img class="${petClass}" src="${gifUri}" alt="${label}" />
    <div class="status">${hasConflict ? "Merge Conflict Detected" : "No Merge Conflicts"}</div>
</body>
</html>`;
  }
};

// src/extension.ts
var hammerTerminal;
var reactTerminal;
var conflictStatusBar = null;
var conflictPetViewProvider = null;
var socket = new WebSocket("ws://127.0.0.1:8765");
async function buttonClicked(conflictStatusBar2, conflictPetViewProvider2) {
  const terminal = getTerminal();
  terminal.show();
  terminal.sendText("git diff --name-only --diff-filter=U");
  const conflictedFunctions = await getConflictedFunctions();
  if (Object.keys(conflictedFunctions).length === 0) {
    if (conflictStatusBar2) {
      conflictStatusBar2.color = new vscode2.ThemeColor("statusBar.debuggingForeground");
      conflictStatusBar2.text = "$(check) \u{1F528} No Merge Conflicts";
      conflictStatusBar2.backgroundColor = void 0;
    }
    vscode2.window.showInformationMessage("No merge conflicts detected in Python files.");
    if (conflictPetViewProvider2) {
      conflictPetViewProvider2.setConflictState(false);
    }
    return;
  }
  if (conflictStatusBar2) {
    conflictStatusBar2.text = "$(warning) \u{1F528} Merge Conflict Detected";
    conflictStatusBar2.backgroundColor = new vscode2.ThemeColor("statusBarItem.errorBackground");
  }
  if (conflictPetViewProvider2) {
    conflictPetViewProvider2.setConflictState(true);
  }
  vscode2.window.showInformationMessage(
    `MC Hammer found conflicts in: ${Object.keys(conflictedFunctions).join(", ")}`
  );
  const targetFunctionFile = Object.keys(conflictedFunctions)[0] ?? "";
  const targetFunction = conflictedFunctions[targetFunctionFile];
  const workspacePath = vscode2.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!targetFunctionFile || !workspacePath) {
    vscode2.window.showErrorMessage("MC Hammer: Could not determine target function or workspace path.");
    return;
  }
  const [remote, curr, commit] = await Promise.all([
    getRemoteFileContent(workspacePath, targetFunctionFile),
    getCurrentFileContent(workspacePath, targetFunctionFile),
    getLatestMainCommitMessage(workspacePath)
  ]);
  if (!remote || !curr || !commit) {
    vscode2.window.showErrorMessage("MC Hammer: Could not retrieve all required data. Aborting send.");
    return;
  }
  const dir = vscode2.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (dir) {
  } else {
    vscode2.window.showErrorMessage("MC Hammer: Could not retrieve working directory. Aborting...");
    return;
  }
}
function execInWorkspace(command, cwd) {
  return new Promise((resolve) => {
    cp.exec(command, { cwd }, (err, stdout) => {
      if (err) {
        resolve("");
        return;
      }
      resolve(stdout);
    });
  });
}
function quoteForShell(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
async function getRemoteFileContent(cwd, filePath) {
  const quotedPath = quoteForShell(filePath);
  const requestedCommand = `git show origin main:${quotedPath}`;
  const requestedOutput = await execInWorkspace(requestedCommand, cwd);
  if (requestedOutput.trim()) {
    return requestedOutput;
  }
  const canonicalCommand = `git show origin/main:${quotedPath}`;
  return execInWorkspace(canonicalCommand, cwd);
}
async function getCurrentFileContent(cwd, filePath) {
  const absolutePath = path.join(cwd, filePath);
  try {
    return await import_fs.promises.readFile(absolutePath, "utf8");
  } catch {
    return "";
  }
}
function getLatestMainCommitMessage(cwd) {
  return execInWorkspace("git log main -1 --pretty=%B", cwd);
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
function getTerminal() {
  if (!hammerTerminal || hammerTerminal.exitStatus !== void 0) {
    hammerTerminal = vscode2.window.createTerminal("MC Hammer");
  }
  return hammerTerminal;
}
function sendToBackend(pwd, conflictedFunctions, targetFunction, curr, remote, commit) {
  const data = JSON.stringify({
    pwd,
    conflicted_functions: conflictedFunctions,
    target_function: targetFunction,
    curr,
    remote,
    commit,
    direct_only: true
  });
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  } else {
    socket.addEventListener("open", () => socket.send(data), { once: true });
  }
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
    vscode2.commands.executeCommand(
      "simpleBrowser.show",
      "http://localhost:5173"
    );
  }, 4e3);
}
async function runApprovedCommand(context, pwd, conflictedFunctions, targetFunction, curr, remote, commit) {
  const result = await vscode2.window.showInformationMessage(
    `MC Hammer wants to work its magic}`,
    { modal: true },
    "Run it",
    "Reject"
  );
  if (result === "Run it") {
    sendToBackend(pwd, conflictedFunctions, targetFunction, curr, remote, commit);
    startReactAndPreview(context);
    return "ran";
  }
  if (result === "Reject") {
    return "rejected";
  }
  return "dismissed";
}
function activate(context) {
  console.log('Congratulations, your extension "mc-hammer" is now active!');
  conflictStatusBar = vscode2.window.createStatusBarItem(
    vscode2.StatusBarAlignment.Left,
    100
  );
  conflictStatusBar.text = "$(check) \u{1F528} No Merge Conflicts";
  conflictStatusBar.backgroundColor = void 0;
  conflictStatusBar.command = "mc-hammer.buttonClicked";
  conflictStatusBar.tooltip = "Click to run MC Hammer on merge conflicts";
  conflictStatusBar.show();
  context.subscriptions.push(conflictStatusBar);
  conflictPetViewProvider = new ConflictPetViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode2.window.registerWebviewViewProvider(
      ConflictPetViewProvider.viewType,
      conflictPetViewProvider
    )
  );
  conflictPetViewProvider.setConflictState(false);
  const gitExtension = vscode2.extensions.getExtension("vscode.git")?.exports;
  if (gitExtension) {
    const git = gitExtension.getAPI(1);
    const attachToRepo = (repo) => {
      context.subscriptions.push(
        repo.state.onDidChange(() => {
          const hasConflict = repo.state.mergeChanges.length > 0;
          if (hasConflict) {
            if (conflictStatusBar) {
              conflictStatusBar.text = "$(warning) \u{1F528} Merge Conflict Detected";
              conflictStatusBar.backgroundColor = new vscode2.ThemeColor("statusBarItem.errorBackground");
            }
            if (conflictPetViewProvider) {
              conflictPetViewProvider.setConflictState(true);
            }
          } else {
            if (conflictStatusBar) {
              conflictStatusBar.text = "$(check) \u{1F528} No Merge Conflicts";
              conflictStatusBar.backgroundColor = void 0;
            }
            if (conflictPetViewProvider) {
              conflictPetViewProvider.setConflictState(false);
            }
          }
        })
      );
    };
    git.repositories.forEach(attachToRepo);
    context.subscriptions.push(git.onDidOpenRepository(attachToRepo));
  } else {
    vscode2.window.showErrorMessage("MC Hammer: Git extension not available.");
  }
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
