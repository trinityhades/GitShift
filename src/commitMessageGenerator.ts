import * as vscode from 'vscode';
import { GitStatus, getStagedFileDiff } from './gitOperations';

/**
 * Error thrown when LM generation fails - signals that user should be prompted for fallback
 */
export class LanguageModelGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LanguageModelGenerationError';
  }
}

/**
 * Generate a detailed commit message using VS Code's Language Model API
 * Falls back to simple format if LM is unavailable or fails
 * Returns a special value that signals when fallback should be prompted
 */
export async function generateDetailedCommitMessage(status: GitStatus, cancelToken?: vscode.CancellationToken): Promise<string> {
  // If no staged files, return empty
  if (status.staged.length === 0) {
    return '';
  }

  try {
    // Check if language models are available
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
      throw new LanguageModelGenerationError('No language models available');
    }

    // Use the first available model
    const model = models[0];

    // Read diffs for all staged files
    const diffs = await Promise.all(
      status.staged.map(async (file) => {
        const diff = await getStagedFileDiff(file);
        return { file, diff };
      })
    );

    // Build the prompt
    const prompt = buildPrompt(diffs);

    // Send to language model with timeout and cancellation
    const timeoutToken = new vscode.CancellationTokenSource();
    const timeout = setTimeout(() => timeoutToken.cancel(), 5000);

    try {
      const result = await Promise.race([
        generateCommitWithModel(model, prompt, cancelToken),
        new Promise<{ content: string }>((_, reject) => {
          const disposable = timeoutToken.token.onCancellationRequested(() => {
            disposable.dispose();
            reject(new LanguageModelGenerationError('Generation timed out'));
          });
        })
      ]);

      clearTimeout(timeout);
      timeoutToken.dispose();

      // Extract the message from the result
      const message = result.content.trim();

      // Validate the message has content
      if (message.length > 0 && message.length < 5000) {
        return message;
      } else {
        throw new LanguageModelGenerationError('Generated message was invalid');
      }
    } finally {
      clearTimeout(timeout);
      timeoutToken.dispose();
    }
  } catch (error) {
    // Re-throw LanguageModelGenerationError to let caller handle the dialog
    if (error instanceof LanguageModelGenerationError) {
      throw error;
    }
    throw new LanguageModelGenerationError('Failed to generate detailed commit message');
  }
}

/**
 * Build the prompt for the language model
 */
function buildPrompt(diffs: Array<{ file: string; diff: string }>): string {
  const fileList = diffs.map(({ file }) => file).join('\n');
  const diffBlocks = diffs
    .map(({ file, diff }) => (diff.trim() ? `File: ${file}\n\`\`\`diff\n${diff}\n\`\`\`` : `File: ${file}\n(No diff - new file)`)
    )
    .join('\n\n');

  return `You are a Git commit message assistant. Analyze the following staged changes and generate a conventional commit message following the format:

type(scope): subject

Body explaining what changed and why (optional but recommended for substantial changes)

Where type is one of: feat, fix, chore, docs, style, refactor, perf, test

Staged files:
${fileList}

Diffs:
${diffBlocks}

Generate a concise but informative commit message that accurately describes the changes. The message should:
1. Start with a conventional commit type and short subject line (50 chars max)
2. Optionally include a body explaining what changed and why
3. Be professional and technical
4. Focus on the actual code changes, not just file names

Commit message:`;
}

/**
 * Generate commit message using the language model
 */
async function generateCommitWithModel(
  model: vscode.LanguageModelChat,
  prompt: string,
  cancelToken?: vscode.CancellationToken
): Promise<{ content: string }> {
  try {
    // Create a user message
    const message = vscode.LanguageModelChatMessage.User(prompt);

    // Use provided cancellation token or create new one
    const token = cancelToken || new vscode.CancellationTokenSource().token;

    // Send request to the model
    const response = await model.sendRequest([message], {}, token);

    // Collect all text chunks from the response stream
    let fullResponse = '';
    for await (const chunk of response.text) {
      // Check if cancelled while reading chunks
      if (cancelToken && cancelToken.isCancellationRequested) {
        throw new LanguageModelGenerationError('Generation was cancelled');
      }
      fullResponse += chunk;
    }

    return { content: fullResponse };
  } catch (error: any) {
    // If it's already a LanguageModelGenerationError, re-throw it
    if (error instanceof LanguageModelGenerationError) {
      throw error;
    }

    // Re-throw as LanguageModelGenerationError
    throw new LanguageModelGenerationError(`Language model request failed: ${error.message || error}`);
  }
}

/**
 * Generate a simple fallback commit message based on file names
 */
export function generateFallbackMessage(status: GitStatus): string {
  const files = status.staged;

  if (files.length === 0) {
    return 'chore: update files';
  }

  // Categorize files by conventional commit type
  const categories: Record<string, string[]> = {
    feat: [],
    fix: [],
    docs: [],
    style: [],
    test: [],
    chore: [],
    refactor: []
  };

  // Get all untracked files to determine if staged files are new
  const allUntracked = status.untracked;

  files.forEach(file => {
    const filename = file.split('/').pop() || file;

    if (file.match(/test|spec/i)) {
      categories.test.push(filename);
    } else if (file.match(/\.md$/i)) {
      categories.docs.push(filename);
    } else if (file.match(/\.css|\.scss|\.less/i)) {
      categories.style.push(filename);
    } else if (file.match(/package\.json|tsconfig|config|\.jsonc/i)) {
      categories.chore.push(filename);
    } else if (allUntracked.includes(file) && file.match(/src|component|feature|page/i)) {
      categories.feat.push(filename);
    } else if (!allUntracked.includes(file)) {
      categories.fix.push(filename);
    } else {
      categories.refactor.push(filename);
    }
  });

  // Build message from first non-empty category
  for (const [type, fileList] of Object.entries(categories)) {
    if (fileList.length > 0) {
      const fileNames = fileList.slice(0, 3).join(', ');
      const extra = fileList.length > 3 ? ` +${fileList.length - 3} more` : '';
      return `${type}: ${fileNames}${extra}`;
    }
  }

  return 'chore: update files';
}

