/**
 * GitShift - Account Manager Module
 * Copyright (c) 2025 mikeeeyy04
 * https://github.com/mikeeeyy04/GitShift
 * 
 * MIT License - See LICENSE file for details
 */

import * as vscode from 'vscode';
import { GitHubAccount } from './types';

const ACCOUNTS_FILE_NAME = 'github-accounts.json';
const GITIGNORE_ENTRY = 'github-accounts.json';

/**
 * Gets the path to the accounts configuration file
 */
function getAccountsFilePath(): vscode.Uri | null {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return null;
  }

  const workspaceRoot = workspaceFolders[0].uri;
  return vscode.Uri.joinPath(workspaceRoot, '.vscode', ACCOUNTS_FILE_NAME);
}

/**
 * Creates the .vscode directory if it doesn't exist
 */
async function ensureVSCodeDirectory(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const vscodeDir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.vscode');
  try {
    await vscode.workspace.fs.stat(vscodeDir);
  } catch {
    // Directory doesn't exist, create it
    await vscode.workspace.fs.createDirectory(vscodeDir);
  }
}

/**
 * Ensures the accounts file is added to .gitignore inside .vscode folder
 * This prevents committing personal account configuration
 */
async function ensureGitignore(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  // Ensure .vscode directory exists first
  await ensureVSCodeDirectory();

  // Create .gitignore inside .vscode folder
  const gitignorePath = vscode.Uri.joinPath(workspaceFolders[0].uri, '.vscode', '.gitignore');

  try {
    // Try to read existing .vscode/.gitignore
    let gitignoreContent = '';
    try {
      const fileContent = await vscode.workspace.fs.readFile(gitignorePath);
      gitignoreContent = fileContent.toString();
    } catch (error: any) {
      // .gitignore doesn't exist, will create it
      gitignoreContent = '';
    }

    // Check if entry already exists (check for various formats)
    const lines = gitignoreContent.split('\n');
    const entryExists = lines.some((line, index) => {
      const trimmed = line.trim();
      return trimmed === GITIGNORE_ENTRY ||
        trimmed === '/github-accounts.json' ||
        trimmed === 'github-accounts.json' ||
        (trimmed === '# GitShift' && lines[index + 1]?.trim() === GITIGNORE_ENTRY);
    });

    if (!entryExists) {
      // Add entry with a comment
      let newContent = gitignoreContent;

      // Add newline if file doesn't end with one
      if (newContent.length > 0 && !newContent.endsWith('\n')) {
        newContent += '\n';
      }

      // Add a blank line if there's existing content
      if (newContent.length > 0) {
        newContent += '\n';
      }

      // Add comment and entry
      newContent += '# GitShift personal account configuration\n';
      newContent += GITIGNORE_ENTRY + '\n';

      // Write back to .vscode/.gitignore
      await vscode.workspace.fs.writeFile(
        gitignorePath,
        Buffer.from(newContent, 'utf8')
      );


    }
  } catch (error) {
    // Silent failure - don't block account creation if .gitignore fails
    console.warn('Failed to update .vscode/.gitignore:', error);
  }
}

/**
 * Loads GitHub accounts from the configuration file
 */
export async function loadAccounts(): Promise<GitHubAccount[]> {
  const accountsFilePath = getAccountsFilePath();
  if (!accountsFilePath) {
    throw new Error('No workspace folder is open');
  }

  try {
    const fileContent = await vscode.workspace.fs.readFile(accountsFilePath);
    const accounts = JSON.parse(fileContent.toString()) as GitHubAccount[];

    // Validate accounts structure
    if (!Array.isArray(accounts)) {
      throw new Error('Invalid accounts file format');
    }

    for (const account of accounts) {
      if (!account.label || !account.name || !account.email) {
        throw new Error('Invalid account structure: missing required fields');
      }
    }

    return accounts;
  } catch (error: any) {
    if (error.code === 'FileNotFound') {
      // File doesn't exist, return empty array
      return [];
    }
    throw error;
  }
}

/**
 * Saves GitHub accounts to the configuration file
 */
export async function saveAccounts(accounts: GitHubAccount[]): Promise<void> {
  const accountsFilePath = getAccountsFilePath();
  if (!accountsFilePath) {
    throw new Error('No workspace folder is open');
  }

  await ensureVSCodeDirectory();

  const fileContent = JSON.stringify(accounts, null, 2);
  await vscode.workspace.fs.writeFile(
    accountsFilePath,
    Buffer.from(fileContent, 'utf8')
  );

  // Automatically add to .gitignore to prevent committing personal config
  await ensureGitignore();
}

/**
 * Creates a default accounts file with example data
 */
export async function createDefaultAccountsFile(): Promise<void> {
  const defaultAccounts: GitHubAccount[] = [
    {
      label: 'Work Account',
      name: 'John Doe (Work)',
      email: 'john.doe@company.com'
    },
    {
      label: 'Personal Account',
      name: 'John Doe',
      email: 'john.doe@gmail.com'
    }
  ];

  await saveAccounts(defaultAccounts);
}

/**
 * Checks if the accounts file exists
 */
export async function accountsFileExists(): Promise<boolean> {
  const accountsFilePath = getAccountsFilePath();
  if (!accountsFilePath) {
    return false;
  }

  try {
    await vscode.workspace.fs.stat(accountsFilePath);
    return true;
  } catch {
    return false;
  }
}

