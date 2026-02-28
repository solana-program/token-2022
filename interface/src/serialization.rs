//! Serialization module - contains helpers for serde types from other crates,
//! deserialization visitors

/// Helper function to serialize / deserialize `COption` wrapped values
pub mod coption_fromstr {
    use {
        serde::{
            de::{Error, Unexpected, Visitor},
            Deserializer, Serializer,
        },
        solana_program_option::COption,
        std::{
            fmt::{self, Display},
            marker::PhantomData,
            str::FromStr,
        },
    };

    /// Serialize values supporting `Display` trait wrapped in `COption`
    pub fn serialize<S, T>(x: &COption<T>, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
        T: Display,
    {
        match *x {
            COption::Some(ref value) => s.serialize_some(&value.to_string()),
            COption::None => s.serialize_none(),
        }
    }

    struct COptionVisitor<T> {
        s: PhantomData<T>,
    }

    impl<'de, T> Visitor<'de> for COptionVisitor<T>
    where
        T: FromStr,
    {
        type Value = COption<T>;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a FromStr type")
        }

        fn visit_some<D>(self, d: D) -> Result<Self::Value, D::Error>
        where
            D: Deserializer<'de>,
        {
            d.deserialize_str(self)
        }

        fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
        where
            E: Error,
        {
            T::from_str(v)
                .map(|r| COption::Some(r))
                .map_err(|_| E::invalid_value(Unexpected::Str(v), &"value string"))
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: Error,
        {
            Ok(COption::None)
        }
    }

    /// Deserialize values supporting `Display` trait wrapped in `COption`
    pub fn deserialize<'de, D, T>(d: D) -> Result<COption<T>, D::Error>
    where
        D: Deserializer<'de>,
        T: FromStr,
    {
        d.deserialize_option(COptionVisitor { s: PhantomData })
    }
}

/// Helper function to serialize / deserialize a `COption` u64 value
pub mod coption_u64_fromval {
    use {
        serde::{
            de::{Error, Visitor},
            Deserializer, Serializer,
        },
        solana_program_option::COption,
        std::fmt,
    };

    /// Serialize u64 wrapped in `COption`
    pub fn serialize<S>(x: &COption<u64>, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match *x {
            COption::Some(ref value) => s.serialize_some(value),
            COption::None => s.serialize_none(),
        }
    }

    struct COptionU64Visitor {}

    impl<'de> Visitor<'de> for COptionU64Visitor {
        type Value = COption<u64>;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a u64 type")
        }

        fn visit_some<D>(self, d: D) -> Result<Self::Value, D::Error>
        where
            D: Deserializer<'de>,
        {
            d.deserialize_u64(self)
        }

        fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E>
        where
            E: Error,
        {
            Ok(COption::Some(v))
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: Error,
        {
            Ok(COption::None)
        }
    }

    /// Deserialize u64 in `COption`
    pub fn deserialize<'de, D>(d: D) -> Result<COption<u64>, D::Error>
    where
        D: Deserializer<'de>,
    {
        d.deserialize_option(COptionU64Visitor {})
    }
}

/// Helper function to serialize / deserialize the data for the `Batch` variant of the
/// `TokenInstruction`
pub mod batch_fromstr {
    use {
        crate::{error::TokenError, instruction::TokenInstruction},
        serde::{
            de::Error as deError,
            ser::{Error as seError, SerializeSeq},
            Deserialize, Deserializer, Serialize, Serializer,
        },
    };

    #[derive(Serialize, Deserialize)]
    #[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
    struct BatchItem<'a> {
        account_count: u8,
        data_length: u8,
        #[serde(borrow)]
        token_instruction: TokenInstruction<'a>,
    }

    /// Serialize the data for the Batch variant of the `TokenInstruction`
    pub fn serialize<S>(mut x: &[u8], s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = s.serialize_seq(None)?;

        loop {
            let (header, rest) = x
                .split_at_checked(2)
                .ok_or(<S as Serializer>::Error::custom(
                    TokenError::InvalidInstruction,
                ))?;

            let (token_instruction, rest) = TokenInstruction::unpack_with_rest(rest)
                .map_err(<S as Serializer>::Error::custom)?;

            if let TokenInstruction::Batch { .. } = token_instruction {
                return Err(<S as Serializer>::Error::custom(
                    TokenError::InvalidInstruction,
                ));
            }

            let batch_item = BatchItem {
                account_count: header[0],
                data_length: header[1],
                token_instruction,
            };

            s.serialize_element(&batch_item)?;

            x = rest;

            if x.is_empty() {
                break;
            }
        }

        s.end()
    }

    /// Deserialize the data for the Batch variant of the `TokenInstruction`
    pub fn deserialize<'de, D>(d: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let items: Vec<BatchItem<'de>> = Vec::deserialize(d)?;

        let mut out = Vec::new();

        for item in items {
            if let TokenInstruction::Batch { .. } = item.token_instruction {
                return Err(<D as Deserializer>::Error::custom(
                    TokenError::InvalidInstruction,
                ));
            }

            out.push(item.account_count);
            out.push(item.data_length);

            let mut instr_data = item.token_instruction.pack();

            out.append(&mut instr_data);
        }

        Ok(out)
    }
}

/// Helper to serialize / deserialize `PodAeCiphertext` values
pub mod aeciphertext_fromstr {
    use {
        serde::{
            de::{Error, Visitor},
            Deserializer, Serializer,
        },
        solana_zk_sdk::encryption::pod::auth_encryption::PodAeCiphertext,
        std::{fmt, str::FromStr},
    };

    /// Serialize `AeCiphertext` values supporting `Display` trait
    pub fn serialize<S>(x: &PodAeCiphertext, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        s.serialize_str(&x.to_string())
    }

    struct AeCiphertextVisitor;

    impl Visitor<'_> for AeCiphertextVisitor {
        type Value = PodAeCiphertext;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a FromStr type")
        }

        fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
        where
            E: Error,
        {
            FromStr::from_str(v).map_err(Error::custom)
        }
    }

    /// Deserialize `AeCiphertext` values from `str`
    pub fn deserialize<'de, D>(d: D) -> Result<PodAeCiphertext, D::Error>
    where
        D: Deserializer<'de>,
    {
        d.deserialize_str(AeCiphertextVisitor)
    }
}

/// Helper to serialize / deserialize `PodElGamalPubkey` values
pub mod elgamalpubkey_fromstr {
    use {
        serde::{
            de::{Error, Visitor},
            Deserializer, Serializer,
        },
        solana_zk_sdk::encryption::pod::elgamal::PodElGamalPubkey,
        std::{fmt, str::FromStr},
    };

    /// Serialize `ElGamalPubkey` values supporting `Display` trait
    pub fn serialize<S>(x: &PodElGamalPubkey, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        s.serialize_str(&x.to_string())
    }

    struct ElGamalPubkeyVisitor;

    impl Visitor<'_> for ElGamalPubkeyVisitor {
        type Value = PodElGamalPubkey;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a FromStr type")
        }

        fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
        where
            E: Error,
        {
            FromStr::from_str(v).map_err(Error::custom)
        }
    }

    /// Deserialize `ElGamalPubkey` values from `str`
    pub fn deserialize<'de, D>(d: D) -> Result<PodElGamalPubkey, D::Error>
    where
        D: Deserializer<'de>,
    {
        d.deserialize_str(ElGamalPubkeyVisitor)
    }
}

/// Helper to serialize / deserialize `PodElGamalCiphertext` values
pub mod elgamalciphertext_fromstr {
    use {
        serde::{
            de::{Error, Visitor},
            Deserializer, Serializer,
        },
        solana_zk_sdk::encryption::pod::elgamal::PodElGamalCiphertext,
        std::{fmt, str::FromStr},
    };

    /// Serialize `ElGamalCiphertext` values supporting `Display` trait
    pub fn serialize<S>(x: &PodElGamalCiphertext, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        s.serialize_str(&x.to_string())
    }

    struct ElGamalCiphertextVisitor;

    impl Visitor<'_> for ElGamalCiphertextVisitor {
        type Value = PodElGamalCiphertext;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a FromStr type")
        }

        fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
        where
            E: Error,
        {
            FromStr::from_str(v).map_err(Error::custom)
        }
    }

    /// Deserialize `ElGamalCiphertext` values from `str`
    pub fn deserialize<'de, D>(d: D) -> Result<PodElGamalCiphertext, D::Error>
    where
        D: Deserializer<'de>,
    {
        d.deserialize_str(ElGamalCiphertextVisitor)
    }
}
