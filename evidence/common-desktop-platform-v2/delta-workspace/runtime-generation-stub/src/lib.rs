#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActiveGenerationIdentity {
    pub generation: u64,
    pub generation_sha256: String,
}
