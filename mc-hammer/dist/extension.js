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
var hammerTerminal;
function getTerminal() {
  if (!hammerTerminal || hammerTerminal.exitStatus !== void 0) {
    hammerTerminal = vscode.window.createTerminal("MC Hammer");
  }
  return hammerTerminal;
}
async function runApprovedCommand(command) {
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
  context.subscriptions.push(disposable);
}
function deactivate() {
  hammerTerminal?.dispose();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate,
  runApprovedCommand
});
//# sourceMappingURL=extension.js.map
