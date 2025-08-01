use {
    crate::extension::{Extension, ExtensionType},
    spl_token_group_interface::state::{TokenGroup, TokenGroupMember},
};

impl Extension for TokenGroup {
    const TYPE: ExtensionType = ExtensionType::TokenGroup;
}

impl Extension for TokenGroupMember {
    const TYPE: ExtensionType = ExtensionType::TokenGroupMember;
}
