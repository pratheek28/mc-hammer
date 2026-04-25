import * as vscode from 'vscode';
import * as path from 'path';

let hammerTerminal: vscode.Terminal | undefined;
let reactTerminal: vscode.Terminal | undefined;

//this is for putting in all commands in one singular terminal so everytime runApprovedCommand is called, it will reuse the same terminal if it exists and is still open, otherwise it will create a new one. This way we can have a single terminal for all commands run through this extension, which can be more organized and easier to manage for the user.
function getTerminal(): vscode.Terminal {
    if (!hammerTerminal || hammerTerminal.exitStatus !== undefined) {
        hammerTerminal = vscode.window.createTerminal('MC Hammer');
    }
    return hammerTerminal;
}

function startReactAndPreview(context: vscode.ExtensionContext): void {
    if (!reactTerminal || reactTerminal.exitStatus !== undefined) {
        const dependencyGraphUIPath = path.join(context.extensionPath, 'dependency-graph-ui');
        reactTerminal = vscode.window.createTerminal({
            name: "Dependency Graph UI",
            cwd: dependencyGraphUIPath
        });
        reactTerminal.sendText('npm run dev');
    }

    setTimeout(() => {
        vscode.commands.executeCommand(
            'simpleBrowser.show',
            'http://localhost:5173'
        );
    }, 4000);
}

// code for showInformationMessage() 
// notification of mc hammer wants to run command with buttons - pass in the command we want to run after approval
// returns if it ran, was rejected, or dismissed 
export async function runApprovedCommand(command: string): Promise<'ran' | 'rejected' | 'dismissed'> {
    const result = await vscode.window.showInformationMessage(
        `MC Hammer wants to run: ${command}`,
        { modal: true },
        'Run it',
        'Reject'
    );

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

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "mc-hammer" is now active!');

    startReactAndPreview(context);

    const disposable = vscode.commands.registerCommand('mc-hammer.helloWorld', () => {
        vscode.window.showInformationMessage('Hello people from mc-hammer!');
    });

    const overlayRunCommand = vscode.commands.registerCommand('mc-hammer.overlayRunWhichPython3', async () => {
        await runApprovedCommand('which python3');
    });

    // A persistent clickable button in the VS Code UI.
    const overlayButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    overlayButton.text = 'MC HAMMER: HAMMER TIME🔨';
    overlayButton.tooltip = 'Run approved command: which python3';
    overlayButton.command = 'mc-hammer.overlayRunWhichPython3';
    overlayButton.show();

    context.subscriptions.push(disposable, overlayRunCommand, overlayButton);
}

export function deactivate() {
    hammerTerminal?.dispose();
    reactTerminal?.dispose();
}