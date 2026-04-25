import * as assert from 'assert';
import * as vscode from 'vscode';
import * as myExtension from '../extension';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Sample test', () => {
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });

    test('runApprovedCommand - ran', async () => {
        (vscode.window.showInformationMessage as any) = async () => 'Run it';
        const result = await myExtension.runApprovedCommand('echo hello');
        assert.strictEqual(result, 'ran');
    });

    test('runApprovedCommand - rejected', async () => {
        (vscode.window.showInformationMessage as any) = async () => 'Reject';
        const result = await myExtension.runApprovedCommand('echo hello');
        assert.strictEqual(result, 'rejected');
    });

    test('runApprovedCommand - dismissed', async () => {
        (vscode.window.showInformationMessage as any) = async () => undefined;
        const result = await myExtension.runApprovedCommand('echo hello');
        assert.strictEqual(result, 'dismissed');
    });
});