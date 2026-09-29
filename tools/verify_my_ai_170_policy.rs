#![forbid(unsafe_code)]

const POLICY: &str = include_str!("../evidence/my-ai-170/SHARED.md");

fn verify() -> Result<(), String> {
    for required in [
        "Credentials are runtime inputs, never repository documentation.",
        "Do not place live or credential-shaped token literals",
        "Treat any credential copied into source control, chat, an issue, or a transcript as exposed material.",
        "Revocation or rotation is a human-authorized operation.",
    ] {
        if !POLICY.contains(required) {
            return Err(format!(
                "missing hardened credential-policy invariant: {required:?}"
            ));
        }
    }

    for forbidden in ["here is an api token"] {
        if POLICY.contains(forbidden) {
            return Err(format!(
                "credential-bearing legacy policy text remains: {forbidden:?}"
            ));
        }
    }

    // Environment-variable names and dynamic exports are valid runtime guidance.
    // Build provider-specific credential canaries at runtime so the test source
    // itself does not contain credential-shaped token literals.
    for prefix in [
        ["gh", "p_"].concat(),
        ["github", "_pat_"].concat(),
        ["lin", "_api_"].concat(),
        ["nt", "n_"].concat(),
    ] {
        if POLICY.contains(&prefix) {
            return Err(format!(
                "credential-shaped provider token prefix remains: {prefix:?}"
            ));
        }
    }

    Ok(())
}

fn main() {
    if let Err(error) = verify() {
        eprintln!("my-ai-170-policy-proof: {error}");
        std::process::exit(1);
    }
    println!("my-ai #170 SHARED.md credential policy is secret-scan clean");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_policy_has_no_embedded_credential_literals() {
        verify().expect("hardened policy");
    }
}
