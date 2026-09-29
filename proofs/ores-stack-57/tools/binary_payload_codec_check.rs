#![forbid(unsafe_code)]

use std::collections::{BTreeMap, BTreeSet};

const MATRIX: &str = include_str!("../conformance/binary-payload-codecs.v1.tsv");
const HEADER: &str = "case\ttransport\tframing\tcodec\twire_id\tmedia_type\tvalid\texpectation";

const REQUIRED_CASES: &[&str] = &[
    "http_json",
    "http_messagepack",
    "http_cbor",
    "http_protobuf",
    "http_raw",
    "http_accept_weighted",
    "http_accept_wildcard",
    "tcp_legacy_ndjson_json",
    "tcp_legacy_ndjson_messagepack",
    "tcp_binary_json",
    "tcp_binary_messagepack",
    "tcp_binary_cbor",
    "tcp_binary_protobuf",
    "tcp_binary_raw",
    "ws_text_json",
    "ws_text_binary",
    "ws_binary_json",
    "ws_binary_messagepack",
    "ws_binary_cbor",
    "ws_binary_protobuf",
    "ws_binary_raw",
    "negative_unknown_codec_id",
    "negative_empty_ws_binary",
    "negative_http_request_media",
    "negative_http_response_accept",
    "negative_http_response_mismatch",
    "negative_over_limit",
    "negative_codec_not_allowed",
    "negative_codec_name_alias",
    "negative_codec_name_case",
    "negative_codec_name_whitespace",
    "negative_trailing_junk_messagepack",
    "negative_trailing_junk_cbor",
    "negative_trailing_junk_protobuf",
    "negative_truncated_structured",
    "negative_duplicate_control_field",
    "negative_binary_semantic_extension",
    "negative_raw_tcp_missing_control",
    "negative_raw_ws_missing_control",
    "negative_decompression_bomb",
    "semantic_equivalence",
    "raw_non_utf8",
    "compression_separate",
    "stream_codec_stability",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CodecSpec {
    wire_id: &'static str,
    media_type: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Row<'a> {
    case_name: &'a str,
    transport: &'a str,
    framing: &'a str,
    codec: &'a str,
    wire_id: &'a str,
    media_type: &'a str,
    valid: bool,
    expectation: &'a str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CaseShape {
    case_name: &'static str,
    transport: &'static str,
    framing: &'static str,
    codec: &'static str,
    wire_id: &'static str,
    media_type: &'static str,
    valid: bool,
}

const REQUIRED_CASE_SHAPES: &[CaseShape] = &[
    CaseShape {
        case_name: "http_accept_weighted",
        transport: "http",
        framing: "native-message",
        codec: "structured",
        wire_id: "-",
        media_type: "-",
        valid: true,
    },
    CaseShape {
        case_name: "http_accept_wildcard",
        transport: "http",
        framing: "native-message",
        codec: "structured",
        wire_id: "-",
        media_type: "-",
        valid: true,
    },
    CaseShape {
        case_name: "negative_codec_name_alias",
        transport: "metadata",
        framing: "contract",
        codec: "msgpack",
        wire_id: "-",
        media_type: "-",
        valid: false,
    },
    CaseShape {
        case_name: "negative_codec_name_case",
        transport: "metadata",
        framing: "contract",
        codec: "JSON",
        wire_id: "-",
        media_type: "-",
        valid: false,
    },
    CaseShape {
        case_name: "negative_codec_name_whitespace",
        transport: "metadata",
        framing: "contract",
        codec: " raw ",
        wire_id: "-",
        media_type: "-",
        valid: false,
    },
    CaseShape {
        case_name: "negative_trailing_junk_messagepack",
        transport: "all",
        framing: "transport-specific",
        codec: "messagepack",
        wire_id: "2",
        media_type: "application/msgpack",
        valid: false,
    },
    CaseShape {
        case_name: "negative_trailing_junk_cbor",
        transport: "all",
        framing: "transport-specific",
        codec: "cbor",
        wire_id: "3",
        media_type: "application/cbor",
        valid: false,
    },
    CaseShape {
        case_name: "negative_trailing_junk_protobuf",
        transport: "all",
        framing: "transport-specific",
        codec: "protobuf",
        wire_id: "4",
        media_type: "application/x-protobuf",
        valid: false,
    },
    CaseShape {
        case_name: "negative_truncated_structured",
        transport: "all",
        framing: "transport-specific",
        codec: "structured",
        wire_id: "-",
        media_type: "-",
        valid: false,
    },
    CaseShape {
        case_name: "negative_duplicate_control_field",
        transport: "all",
        framing: "transport-specific",
        codec: "structured",
        wire_id: "-",
        media_type: "-",
        valid: false,
    },
    CaseShape {
        case_name: "negative_binary_semantic_extension",
        transport: "all",
        framing: "transport-specific",
        codec: "structured",
        wire_id: "-",
        media_type: "-",
        valid: false,
    },
    CaseShape {
        case_name: "negative_raw_tcp_missing_control",
        transport: "tcp",
        framing: "length-prefixed-32be+codec",
        codec: "raw",
        wire_id: "5",
        media_type: "application/octet-stream",
        valid: false,
    },
    CaseShape {
        case_name: "negative_raw_ws_missing_control",
        transport: "websocket",
        framing: "binary-message+codec",
        codec: "raw",
        wire_id: "5",
        media_type: "application/octet-stream",
        valid: false,
    },
    CaseShape {
        case_name: "negative_decompression_bomb",
        transport: "all",
        framing: "transport-specific",
        codec: "structured",
        wire_id: "-",
        media_type: "-",
        valid: false,
    },
    CaseShape {
        case_name: "semantic_equivalence",
        transport: "all",
        framing: "transport-specific",
        codec: "structured",
        wire_id: "-",
        media_type: "-",
        valid: true,
    },
    CaseShape {
        case_name: "compression_separate",
        transport: "all",
        framing: "transport-specific",
        codec: "structured",
        wire_id: "-",
        media_type: "-",
        valid: true,
    },
    CaseShape {
        case_name: "stream_codec_stability",
        transport: "all",
        framing: "streaming",
        codec: "structured",
        wire_id: "-",
        media_type: "-",
        valid: true,
    },
];

fn canonical_codecs() -> BTreeMap<&'static str, CodecSpec> {
    return BTreeMap::from([
        (
            "json",
            CodecSpec {
                wire_id: "1",
                media_type: "application/json",
            },
        ),
        (
            "messagepack",
            CodecSpec {
                wire_id: "2",
                media_type: "application/msgpack",
            },
        ),
        (
            "cbor",
            CodecSpec {
                wire_id: "3",
                media_type: "application/cbor",
            },
        ),
        (
            "protobuf",
            CodecSpec {
                wire_id: "4",
                media_type: "application/x-protobuf",
            },
        ),
        (
            "raw",
            CodecSpec {
                wire_id: "5",
                media_type: "application/octet-stream",
            },
        ),
    ]);
}

fn parse_matrix(source: &str) -> Result<Vec<Row<'_>>, String> {
    let mut rows = Vec::new();

    for (index, line) in source.lines().enumerate() {
        if index == 0 {
            if line != HEADER {
                return Err("binary payload matrix header is not canonical".to_owned());
            }
            continue;
        }

        if line.is_empty() {
            continue;
        }

        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() != 8 {
            return Err(format!(
                "binary payload matrix line {} must contain eight tab-separated fields",
                index + 1,
            ));
        }

        if fields.iter().any(|field| field.is_empty()) {
            return Err(format!(
                "binary payload matrix line {} contains an empty field",
                index + 1,
            ));
        }

        let valid = match fields[6] {
            "true" => true,
            "false" => false,
            other => {
                return Err(format!(
                    "binary payload matrix line {} has invalid boolean {other:?}",
                    index + 1,
                ));
            }
        };

        rows.push(Row {
            case_name: fields[0],
            transport: fields[1],
            framing: fields[2],
            codec: fields[3],
            wire_id: fields[4],
            media_type: fields[5],
            valid,
            expectation: fields[7],
        });
    }

    if rows.is_empty() {
        return Err("binary payload matrix must not be empty".to_owned());
    }

    return Ok(rows);
}

fn require_case_shape(rows: &[Row<'_>], expected: CaseShape) -> Result<(), String> {
    let Some(row) = rows
        .iter()
        .find(|row| row.case_name == expected.case_name)
    else {
        return Err(format!(
            "binary payload matrix is missing required case {:?}",
            expected.case_name,
        ));
    };

    if row.transport != expected.transport
        || row.framing != expected.framing
        || row.codec != expected.codec
        || row.wire_id != expected.wire_id
        || row.media_type != expected.media_type
        || row.valid != expected.valid
    {
        return Err(format!(
            "binary payload case {:?} has drifted structural semantics: got transport={:?} framing={:?} codec={:?} wire_id={:?} media_type={:?} valid={:?}",
            expected.case_name,
            row.transport,
            row.framing,
            row.codec,
            row.wire_id,
            row.media_type,
            row.valid,
        ));
    }

    return Ok(());
}

fn validate(rows: &[Row<'_>]) -> Result<(), String> {
    let codecs = canonical_codecs();
    let mut seen_cases = BTreeSet::new();
    let mut present_cases = BTreeSet::new();

    for row in rows {
        if !seen_cases.insert(row.case_name) {
            return Err(format!(
                "binary payload matrix contains duplicate case {:?}",
                row.case_name,
            ));
        }
        present_cases.insert(row.case_name);

        if row.case_name.starts_with("negative_") && row.valid {
            return Err(format!(
                "negative binary payload case {:?} must be marked false",
                row.case_name,
            ));
        }

        if let Some(spec) = codecs.get(row.codec) {
            if row.wire_id != spec.wire_id {
                return Err(format!(
                    "case {:?} uses wire id {:?} for codec {:?}; expected {:?}",
                    row.case_name, row.wire_id, row.codec, spec.wire_id,
                ));
            }
            if row.media_type != spec.media_type {
                return Err(format!(
                    "case {:?} uses media type {:?} for codec {:?}; expected {:?}",
                    row.case_name, row.media_type, row.codec, spec.media_type,
                ));
            }
        } else if row.valid && row.codec != "structured" {
            return Err(format!(
                "positive case {:?} uses unknown codec {:?}",
                row.case_name, row.codec,
            ));
        }

        if row.codec == "structured" && (row.wire_id != "-" || row.media_type != "-") {
            return Err(format!(
                "aggregate structured case {:?} must not invent a single wire id or media type",
                row.case_name,
            ));
        }

        if row.valid && row.framing == "ndjson" && row.codec != "json" {
            return Err(format!(
                "NDJSON positive case {:?} must use JSON, not {:?}",
                row.case_name, row.codec,
            ));
        }

        if row.valid && matches!(row.transport, "tcp" | "websocket") && row.codec == "raw" {
            let normalized = row.expectation.to_ascii_lowercase();
            if !normalized.contains("control") || !normalized.contains("correlation") {
                return Err(format!(
                    "raw stateful case {:?} must explicitly preserve control and correlation metadata",
                    row.case_name,
                ));
            }
        }
    }

    for required in REQUIRED_CASES {
        if !present_cases.contains(required) {
            return Err(format!(
                "binary payload matrix is missing required hardened case {required:?}"
            ));
        }
    }

    for expected in REQUIRED_CASE_SHAPES {
        require_case_shape(rows, *expected)?;
    }

    let canonical_positive = rows
        .iter()
        .filter(|row| row.valid && codecs.contains_key(row.codec))
        .map(|row| row.codec)
        .collect::<BTreeSet<_>>();
    let expected_codecs = codecs.keys().copied().collect::<BTreeSet<_>>();
    if canonical_positive != expected_codecs {
        return Err(format!(
            "positive matrix coverage must exercise all canonical codecs; got {canonical_positive:?}"
        ));
    }

    return Ok(());
}

fn run() -> Result<(), String> {
    let rows = parse_matrix(MATRIX)?;
    validate(&rows)?;
    println!(
        "validated {} binary payload conformance cases across {} canonical codecs",
        rows.len(),
        canonical_codecs().len(),
    );
    return Ok(());
}

fn main() {
    if let Err(error) = run() {
        eprintln!("binary-payload-conformance: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checked_in_matrix_is_hardened() {
        let rows = parse_matrix(MATRIX).expect("parse matrix");
        validate(&rows).expect("matrix must validate");
    }

    #[test]
    fn duplicate_case_is_rejected() {
        let mut source = MATRIX.to_owned();
        let duplicate = MATRIX
            .lines()
            .find(|line| line.starts_with("http_json\t"))
            .expect("http_json row");
        source.push_str(duplicate);
        source.push('\n');
        let rows = parse_matrix(&source).expect("parse duplicate matrix");
        assert!(validate(&rows).is_err());
    }

    #[test]
    fn canonical_wire_id_drift_is_rejected() {
        let source = MATRIX.replacen(
            "http_cbor\thttp\tnative-message\tcbor\t3\tapplication/cbor",
            "http_cbor\thttp\tnative-message\tcbor\t4\tapplication/cbor",
            1,
        );
        let rows = parse_matrix(&source).expect("parse drift matrix");
        assert!(validate(&rows).is_err());
    }

    #[test]
    fn canonical_wire_metadata_drift_is_rejected_even_for_negative_rows() {
        let source = MATRIX.replacen(
            "negative_trailing_junk_cbor\tall\ttransport-specific\tcbor\t3\tapplication/cbor",
            "negative_trailing_junk_cbor\tall\ttransport-specific\tcbor\t4\tapplication/x-cbor",
            1,
        );
        let rows = parse_matrix(&source).expect("parse drift matrix");
        assert!(validate(&rows).is_err());
    }

    #[test]
    fn required_hardening_case_shape_is_rejected_when_weakened() {
        let source = MATRIX.replacen(
            "negative_trailing_junk_cbor\tall\ttransport-specific\tcbor\t3\tapplication/cbor",
            "negative_trailing_junk_cbor\thttp\tnative-message\tcbor\t3\tapplication/cbor",
            1,
        );
        let rows = parse_matrix(&source).expect("parse weakened matrix");
        assert!(validate(&rows).is_err());
    }

    #[test]
    fn missing_hardening_case_is_rejected() {
        let source = MATRIX
            .lines()
            .filter(|line| !line.starts_with("negative_decompression_bomb\t"))
            .collect::<Vec<_>>()
            .join("\n");
        let rows = parse_matrix(&source).expect("parse reduced matrix");
        assert!(validate(&rows).is_err());
    }

    #[test]
    fn raw_stateful_positive_requires_control_and_correlation_language() {
        let source = MATRIX.replacen(
            "raw body bytes remain inside/after typed RPC control metadata carrying protocol version operation key request/correlation id and message kind; bare opaque body is not generic RPC",
            "raw bytes are preserved",
            1,
        );
        let rows = parse_matrix(&source).expect("parse weakened matrix");
        assert!(validate(&rows).is_err());
    }
}
