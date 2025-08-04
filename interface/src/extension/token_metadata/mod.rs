use {
    crate::extension::{Extension, ExtensionType},
    spl_token_metadata_interface::state::TokenMetadata,
};

impl Extension for TokenMetadata {
    const TYPE: ExtensionType = ExtensionType::TokenMetadata;
}
