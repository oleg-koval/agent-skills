# Project review profile

Use this profile to give reviewers the repository's review rules and conventions.
The default profile declares no project-specific requirements. Add explicit
rules to `references/house-rules.md` and include them here when using revmux.
Use a stable rule ID so a finding can cite the governing rule and evidence.

## 1. Naming

Check new names against established names for equivalent concepts in the target repository.

## 2. Comments

Look for explanations of invariants, workarounds, and surprising constraints.

## 3. Debug artifacts

Flag debug output, breakpoints, and temporary files when the diff would ship them unintentionally.

## 4. Tests

Apply the target repository's test conventions and check that assertions exercise observable behavior.

## 5. Commits

Apply commit conventions declared by the project or demonstrated by comparable changes.

## 6. Generated code

Check that a source change includes its required generated output. Review the source for quality findings.
