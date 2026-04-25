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
var cp = __toESM(require("child_process"));
var path = __toESM(require("path"));
var import_fs = require("fs");
var hammerTerminal;
var reactTerminal;
var socket = new WebSocket("ws://127.0.0.1:8765");
async function buttonClicked(context) {
  const terminal = getTerminal();
  terminal.show();
  terminal.sendText("git diff --name-only --diff-filter=U");
  const conflictedFunctions = await getConflictedFunctions();
  if (Object.keys(conflictedFunctions).length === 0) {
    vscode.window.showInformationMessage("No merge conflicts detected in Python files.");
    return;
  }
  vscode.window.showInformationMessage(
    `MC Hammer found conflicts in: ${Object.keys(conflictedFunctions).join(", ")}`
  );
  const targetFunctionFile = Object.keys(conflictedFunctions)[0] ?? "";
  const targetFunction = conflictedFunctions[targetFunctionFile];
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!targetFunctionFile || !workspacePath) {
    vscode.window.showErrorMessage("MC Hammer: Could not determine target function or workspace path.");
    return;
  }
  const [remote, curr, commit] = await Promise.all([
    getRemoteFileContent(workspacePath, targetFunctionFile),
    getCurrentFileContent(workspacePath, targetFunctionFile),
    getLatestMainCommitMessage(workspacePath)
  ]);
  if (!remote || !curr || !commit) {
    vscode.window.showErrorMessage("MC Hammer: Could not retrieve all required data. Aborting send.");
    return;
  }
  const dir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (dir) {
    runApprovedCommand(context, dir, JSON.stringify(conflictedFunctions), targetFunction[0], curr, remote, commit);
  } else {
    vscode.window.showErrorMessage("MC Hammer: Could not retrieve working directory. Aborting...");
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
  const workspaceFolders = vscode.workspace.workspaceFolders;
  console.log("[MC Hammer] workspaceFolders:", workspaceFolders?.map((f) => f.uri.fsPath));
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage("MC Hammer: No workspace folder is open.");
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
        const doc = await vscode.workspace.openTextDocument(fullPath);
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
    hammerTerminal = vscode.window.createTerminal("MC Hammer");
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
async function runApprovedCommand(context, pwd, conflictedFunctions, targetFunction, curr, remote, commit) {
  const result = await vscode.window.showInformationMessage(
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
  const conflictStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  conflictStatusBar.text = "\u{1F528} MC Hammer: Merge Conflict Detected";
  conflictStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  conflictStatusBar.command = "mc-hammer.buttonClicked";
  conflictStatusBar.tooltip = "Click to run MC Hammer on merge conflicts";
  conflictStatusBar.hide();
  context.subscriptions.push(conflictStatusBar);
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.py");
  watcher.onDidChange(async (uri) => {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (doc.getText().includes("<<<<<<<")) {
      conflictStatusBar.show();
      vscode.window.showInformationMessage(
        `MC Hammer detected a merge conflict in ${uri.fsPath}`
      );
    } else {
      conflictStatusBar.hide();
    }
  });
  context.subscriptions.push(watcher);
  const disposable = vscode.commands.registerCommand("mc-hammer.helloWorld", () => {
    vscode.window.showInformationMessage("Hello! from mc-hammer!");
  });
  const hammerButton = vscode.commands.registerCommand("mc-hammer.buttonClicked", () => {
    buttonClicked(context).catch((err) => {
      vscode.window.showErrorMessage(`MC Hammer error: ${err.message}`);
    });
  });
  context.subscriptions.push(disposable);
  context.subscriptions.push(hammerButton);
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
