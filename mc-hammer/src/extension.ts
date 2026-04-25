import * as vscode from 'vscode';

let hammerTerminal: vscode.Terminal | undefined;

//this is for putting in all commands in one singular terminal so everytime runApprovedCommand is called, it will reuse the same terminal if it exists and is still open, otherwise it will create a new one. This way we can have a single terminal for all commands run through this extension, which can be more organized and easier to manage for the user.
function getTerminal(): vscode.Terminal {
    if (!hammerTerminal || hammerTerminal.exitStatus !== undefined) {
        hammerTerminal = vscode.window.createTerminal('MC Hammer');
    }
    return hammerTerminal;
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



    const overlayRunCommand = vscode.commands.registerCommand('mc-hammer.buttonClicked', async () => {
        // Detect which files have conflicts

		// Send file contents to AI backend
		// Streamed back to the frontend in order using websockets:
		// Test cases + expected results
		// Diagnosis (what kind of conflict, which approach, severity of merge conflict)
		// Treatment (suggested changes to make and why, everything the AI did in the pipeline)
		
		
    });

    // A persistent clickable button in the VS Code UI.
    const overlayButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    overlayButton.text = 'MC HAMMER: HAMMER TIME 🔨';
    overlayButton.tooltip = 'Run approved command: which python3';
    overlayButton.command = 'mc-hammer.overlayRunWhichPython3';
    overlayButton.show();

    context.subscriptions.push(dis