"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runApprovedCommand = runApprovedCommand;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
let hammerTerminal;
//this is for putting in all commands in one singular terminal so everytime runApprovedCommand is called, it will reuse the same terminal if it exists and is still open, otherwise it will create a new one. This way we can have a single terminal for all commands run through this extension, which can be more organized and easier to manage for the user.
function getTerminal() {
    if (!hammerTerminal || hammerTerminal.exitStatus !== undefined) {
        hammerTerminal = vscode.window.createTerminal('MC Hammer');
    }
    return hammerTerminal;
}
// code for showInformationMessage() 
// notification of mc hammer wants to run command with buttons - pass in the command we want to run after approval
// returns if it ran, was rejected, or dismissed 
async function runApprovedCommand(command) {
    const result = await vscode.window.showInformationMessage(`MC Hammer wants to run: ${command}`, { modal: true }, 'Run it', 'Reject');
    if (result === 'Run it') {
        const terminal = getTerminal();
        terminal.show();
        terminal.sendText(command);
        return 'ran';
    }
    if (result === 'Reject') {
        return 'rejected';
    }
    return 'dismissed';
}
function activate(context) {
    console.log('Congratulations, your extension "mc-hammer" is now active!');
    const disposable = vscode.commands.registerCommand('mc-hammer.helloWorld', () => {
        vscode.window.showInformationMessage('Hello people from mc-hammer!');
    });
    context.subscriptions.push(disposable);
}
function deactivate() {
    hammerTerminal?.dispose();
}
//# sourceMappingURL=extension.js.map