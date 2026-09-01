# Security Policy

## Purpose

This policy defines the security expectations for this repository and its contributors. Its goal is to protect source code, credentials, user data, infrastructure, and related assets from unauthorized access, modification, disclosure, or loss.

## Scope

This policy applies to all contributors, maintainers, contractors, and automated systems with access to the repository, deployments, secrets, or related services. It covers code, issues, pull requests, CI/CD, package registries, cloud infrastructure, and communication channels used for project operations.

## Access Control

Access should follow the principle of least privilege, with permissions granted only as needed for a specific role or task. Sensitive actions such as releasing, deploying, or changing secrets should be restricted to approved maintainers. Access must be removed promptly when it is no longer required.

## Secrets and Credentials

Secrets must never be committed to the repository, pasted into issues, or shared in public channels. API keys, tokens, private keys, and credentials must be stored only in approved secret managers or environment variables. If a secret is exposed, it must be rotated immediately and the incident reported.

## Code and Dependency Security

Changes should be reviewed before merging, especially for authentication, authorization, cryptography, and data-handling logic. Dependencies should be kept current and reviewed for known vulnerabilities. Untrusted code, scripts, and third-party packages should be evaluated before use.

## Data Handling

Only collect and store data that is necessary for the project. Sensitive or personal data should be minimized, protected, and removed when no longer needed. Access to production data should be limited and logged where possible.

## Incident Reporting

Anyone who suspects a security issue should report it immediately to the maintainers. Reports should include enough detail to reproduce or assess the issue without exposing secrets publicly. Maintainers should triage, contain, fix, and document the issue as quickly as practical.

## Exceptions

Any exception to this policy must be explicitly approved by a maintainer and documented with the reason, scope, and expiration date. Temporary exceptions should be reviewed and removed as soon as possible.

## Review

This policy should be reviewed regularly and updated when the project, infrastructure, or threat model changes. At minimum, it should be reviewed once per year or after a significant security incident.
