# Contributing to GitShift

Thank you for your interest in contributing to GitShift! 🎉

This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Questions?](#questions)

## Code of Conduct

This project adheres to a code of conduct. By participating, you are expected to:

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect different viewpoints and experiences

## How Can I Contribute?

### Reporting Bugs

Found a bug? We'd love to know about it!

**Before reporting:**

- Check if the issue already exists in the [Issues](https://github.com/mikeeeyy04/GitShift/issues) page
- Verify you're using the latest version
- Check the [Troubleshooting](README.md#troubleshooting) section in the README

**When reporting:**

1. Use the [Bug Report](https://github.com/mikeeeyy04/GitShift/issues/new?template=bug_report.md) template
2. Include:
   - Clear description of the bug
   - Steps to reproduce
   - Expected vs actual behavior
   - VS Code version
   - Extension version
   - Screenshots if applicable
   - Error messages/logs

### Suggesting Features

Have an idea for a new feature?

1. Check if it's already been suggested in [Issues](https://github.com/mikeeeyy04/GitShift/issues)
2. Use the [Feature Request](https://github.com/mikeeeyy04/GitShift/issues/new?template=feature_request.md) template
3. Explain:
   - The problem it solves
   - Your proposed solution
   - Alternatives you've considered
   - Use cases

### Code Contributions

We welcome code contributions! Here's how to get started:

#### Development Setup

1. **Fork the repository**

   ```bash
   git clone https://github.com/your-username/GitShift.git
   cd GitShift
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Compile the extension**

   ```bash
   npm run compile
   ```

4. **Open in VS Code**

   ```bash
   code .
   ```

5. **Run the extension**
   - Press `F5` to open a new Extension Development Host window
   - The extension will be loaded in the new window
   - Make changes and use `Ctrl+R` (or `Cmd+R`) to reload

#### Development Workflow

1. **Create a branch**

   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Make your changes**

   - Follow the [Coding Standards](#coding-standards)
   - Write or update tests if applicable
   - Update documentation if needed

3. **Test your changes**

   - Run `npm run compile` to check for TypeScript errors
   - Run `npm run lint` to check code style
   - Test manually in the Extension Development Host

4. **Commit your changes**

   - Follow the [Commit Guidelines](#commit-guidelines)

5. **Push and create a Pull Request**
   ```bash
   git push origin feature/your-feature-name
   ```

## Coding Standards

### TypeScript

- **Strict mode**: All TypeScript strict checks are enabled
- **Type safety**: Use proper types, avoid `any` when possible
- **Naming**:
  - Use camelCase for variables and functions
  - Use PascalCase for classes and interfaces
  - Use UPPER_CASE for constants

### Code Style

- Follow existing code patterns
- Use 2 spaces for indentation
- Maximum line length: 120 characters
- Add comments for complex logic
- Keep functions focused and small

### ESLint

Run the linter before committing:

```bash
npm run lint
```

Fix auto-fixable issues:

```bash
npm run lint -- --fix
```

### File Structure

```
src/
├── extension.ts          # Main entry point
├── accountManager.ts     # Account management logic
├── githubAuth.ts         # GitHub authentication
├── gitManager.ts         # Git operations
├── gitOperations.ts      # Advanced Git commands
├── gitCredentials.ts     # Credential management
├── statusBar.ts          # Status bar integration
├── sidebarWebview.ts     # Sidebar UI
├── repositoryWebview.ts  # Repository view
├── contributionsWebview.ts # Contributions view
├── supportWebview.ts     # Support view
├── accountTreeView.ts    # Tree view provider
└── types.ts              # TypeScript types
```

### Best Practices

1. **Error Handling**

   - Always handle errors gracefully
   - Show user-friendly error messages
   - Log errors to the output channel for debugging

2. **Security**

   - Never log or expose tokens or sensitive data
   - Use VS Code's Secret Storage API for tokens
   - Validate user input

3. **Performance**

   - Avoid blocking the main thread
   - Use async/await for I/O operations
   - Cache results when appropriate

4. **User Experience**
   - Provide clear feedback for actions
   - Use VS Code's notification API appropriately
   - Follow VS Code UI/UX guidelines

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```
feat(auth): Add token validation on startup

Adds automatic token validation when the extension activates.
Tokens are checked against GitHub API to ensure they're still valid.

fix(ui): Fix sidebar refresh issue

The sidebar was not updating when accounts were added via command palette.

docs(readme): Update installation instructions

Add marketplace installation as primary method.
```

### Commit Messages

- Use imperative mood: "Add feature" not "Added feature"
- Keep subject line under 72 characters
- Capitalize first letter
- No period at the end
- Reference issues: `Closes #123` or `Fixes #123`

## Pull Request Process

1. **Before submitting:**

   - Ensure your code compiles: `npm run compile`
   - Run the linter: `npm run lint`
   - Test your changes thoroughly
   - Update documentation if needed
   - Update CHANGELOG.md if applicable

2. **Create the Pull Request:**

   - Use a descriptive title
   - Reference related issues
   - Describe what changes you made and why
   - Add screenshots/GIFs for UI changes
   - Fill out the PR template

3. **PR Review:**

   - Respond to feedback promptly
   - Make requested changes
   - Keep discussions focused and respectful
   - Be patient during review

4. **After approval:**
   - Maintainers will merge your PR
   - Thank you for your contribution! 🎉

### PR Template

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Code refactoring
- [ ] Performance improvement

## Testing

How did you test your changes?

## Checklist

- [ ] Code compiles without errors
- [ ] Linter passes
- [ ] Tests pass (if applicable)
- [ ] Documentation updated
- [ ] CHANGELOG updated (if applicable)
- [ ] No breaking changes (or documented)
```

## Testing

### Manual Testing

1. Test in Extension Development Host window
2. Test with different VS Code versions if possible
3. Test on different operating systems if available
4. Test edge cases and error scenarios

### Automated Testing

- Run TypeScript compiler: `npm run compile`
- Run ESLint: `npm run lint`
- Check for TypeScript errors

## Documentation

When adding new features:

1. Update README.md if it's a user-facing feature
2. Add JSDoc comments for public APIs
3. Update CHANGELOG.md
4. Add examples if applicable

## Questions?

- **General questions**: Open a [Discussion](https://github.com/mikeeeyy04/GitShift/discussions)
- **Bug reports**: Open an [Issue](https://github.com/mikeeeyy04/GitShift/issues)
- **Security issues**: Please email directly or use GitHub's private reporting

## Recognition

Contributors will be:

- Listed in the README.md
- Credited in release notes
- Recognized in the project

Thank you for contributing to GitShift! Your efforts help make this extension better for everyone. 🙏

---

**Note**: By contributing, you agree that your contributions will be licensed under the same MIT License as the project.
