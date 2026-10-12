// Copyright 2026 Sion contributors.
// SPDX-License-Identifier: Apache-2.0

//! Workaround for LiveKit offers with heterogeneous Opus stereo parameters.
//! RFC 8843 §9.1.1 requires identical codec parameters when bundled media
//! reuse a payload type. RFC 7587 permits both mono and stereo decoding.

use std::collections::BTreeMap;

const STEREO_PARAMETERS: [&str; 2] = ["stereo", "sprop-stereo"];

struct Opus<'a> {
    pt: &'a str,
    rtpmap: usize,
    fmtp: Option<usize>,
}

struct Media<'a> {
    mid: &'a str,
    opus: Vec<Opus<'a>>,
}

fn fmtp(line: &str) -> Option<(&str, &str)> {
    let rest = line.strip_prefix("a=fmtp:")?;
    Some(rest.split_once(char::is_whitespace).unwrap_or((rest, "")))
}

fn parameter<'a>(params: &'a str, key: &str) -> Option<&'a str> {
    params.split(';').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        (name.trim() == key).then_some(value.trim())
    })
}

/// Returns a replacement only when stereo parameters differ between audio
/// sections in the same BUNDLE group using the same Opus/48000/2 payload.
/// Other codecs, payloads, groups and SDP attributes remain untouched.
pub(crate) fn normalize_opus_stereo(text: &str) -> Option<String> {
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let lines: Vec<_> = text.split(eol).collect();
    let starts: Vec<_> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| line.starts_with("m=").then_some(i))
        .collect();
    let first_media = *starts.first()?;
    let groups: Vec<Vec<_>> = lines[..first_media]
        .iter()
        .filter_map(|line| {
            let mut parts = line.strip_prefix("a=group:")?.split_whitespace();
            (parts.next()? == "BUNDLE").then(|| parts.collect())
        })
        .collect();
    if groups.is_empty() {
        return None;
    }
    let mut media = Vec::new();
    for (i, &start) in starts.iter().enumerate() {
        let end = starts.get(i + 1).copied().unwrap_or(lines.len());
        let section = &lines[start..end];
        let fields: Vec<_> = lines[start].split_whitespace().collect();
        if fields.first() != Some(&"m=audio") || fields.len() < 4 {
            continue;
        }
        // Rejected sections are not part of the active transport. A zero
        // port with bundle-only, however, still advertises bundled media.
        if fields[1] == "0" && !section.contains(&"a=bundle-only") {
            continue;
        }
        let Some(mid) = section.iter().find_map(|line| line.strip_prefix("a=mid:")) else {
            continue;
        };
        let mut opus = Vec::new();
        for (offset, line) in section.iter().enumerate() {
            let Some(rest) = line.strip_prefix("a=rtpmap:") else {
                continue;
            };
            let mut parts = rest.split_whitespace();
            let (Some(pt), Some(codec)) = (parts.next(), parts.next()) else {
                continue;
            };
            if !codec.eq_ignore_ascii_case("opus/48000/2") || !fields[3..].contains(&pt) {
                continue;
            }
            let fmtp = section
                .iter()
                .position(|line| fmtp(line).is_some_and(|(p, _)| p == pt));
            opus.push(Opus {
                pt,
                rtpmap: start + offset,
                fmtp: fmtp.map(|p| start + p),
            });
        }
        media.push(Media { mid, opus });
    }
    let mut replacements = BTreeMap::new();
    let mut additions = BTreeMap::new();
    for group in groups {
        let mut payloads: BTreeMap<&str, Vec<&Opus<'_>>> = BTreeMap::new();
        for section in &media {
            if group.contains(&section.mid) {
                for opus in &section.opus {
                    payloads.entry(opus.pt).or_default().push(opus);
                }
            }
        }
        for codecs in payloads.values().filter(|codecs| codecs.len() > 1) {
            let mut targets = [None; 2];
            for (i, key) in STEREO_PARAMETERS.iter().enumerate() {
                let values: Vec<_> = codecs
                    .iter()
                    .map(|opus| {
                        opus.fmtp
                            .and_then(|line| fmtp(lines[line]))
                            .and_then(|(_, params)| parameter(params, key))
                    })
                    .collect();
                if values.iter().any(|v| !matches!(v, None | Some("0" | "1"))) {
                    continue; // Do not repair invalid or unknown parameter values.
                }
                if values.iter().all(|v| *v == values[0]) {
                    continue;
                }
                // Preserve stereo whenever any of the bundled tracks needs it.
                targets[i] = Some(if values.contains(&Some("1")) {
                    "1"
                } else {
                    "0"
                });
            }
            if targets.iter().all(Option::is_none) {
                continue;
            }
            for opus in codecs {
                let params = opus
                    .fmtp
                    .and_then(|line| fmtp(lines[line]))
                    .map(|(_, p)| p)
                    .unwrap_or("");
                if STEREO_PARAMETERS
                    .iter()
                    .zip(targets.iter())
                    .all(|(key, target)| target.is_none() || parameter(params, key) == *target)
                {
                    continue;
                }
                let mut parts: Vec<_> = params
                    .split(';')
                    .map(str::trim)
                    .filter(|part| {
                        !part.is_empty()
                            && !STEREO_PARAMETERS
                                .iter()
                                .zip(targets.iter())
                                .any(|(key, target)| {
                                    target.is_some()
                                        && part
                                            .split_once('=')
                                            .is_some_and(|(name, _)| name.trim() == *key)
                                })
                    })
                    .map(str::to_owned)
                    .collect();
                for (key, target) in STEREO_PARAMETERS.iter().zip(targets.iter()) {
                    if let Some(value) = target {
                        parts.push(format!("{key}={value}"));
                    }
                }
                let line = format!("a=fmtp:{} {}", opus.pt, parts.join(";"));
                if let Some(index) = opus.fmtp {
                    replacements.insert(index, line);
                } else {
                    additions.insert(opus.rtpmap, line);
                }
            }
        }
    }
    if replacements.is_empty() && additions.is_empty() {
        return None;
    }
    let mut out = String::with_capacity(text.len() + 64);
    for (i, line) in lines.iter().enumerate() {
        if i > 0 {
            out.push_str(eol);
        }
        out.push_str(replacements.get(&i).map(String::as_str).unwrap_or(line));
        if let Some(added) = additions.get(&i) {
            out.push_str(eol);
            out.push_str(added);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn audio(mid: &str, pt: &str, params: Option<&str>) -> String {
        let mut out = format!(
            "m=audio 9 UDP/TLS/RTP/SAVPF {pt}\r\na=mid:{mid}\r\na=rtpmap:{pt} opus/48000/2\r\n"
        );
        if let Some(params) = params {
            out.push_str(&format!("a=fmtp:{pt} {params}\r\n"));
        }
        out
    }

    fn sdp(groups: &str, sections: &[String]) -> String {
        format!(
            "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n{groups}{}",
            sections.concat()
        )
    }

    #[test]
    fn mixed_stereo_reproduces_the_logged_collision() {
        let input = sdp(
            "a=group:BUNDLE mic share\r\n",
            &[
                audio("mic", "111", Some("minptime=10;useinbandfec=1")),
                audio("share", "111", Some("minptime=10;stereo=1;useinbandfec=1")),
            ],
        );
        let output = normalize_opus_stereo(&input).unwrap();
        assert_eq!(output.matches("stereo=1").count(), 2);
        assert_eq!(output.matches("minptime=10").count(), 2);
        assert_eq!(output.matches("useinbandfec=1").count(), 2);
        assert!(normalize_opus_stereo(&output).is_none());
    }

    #[test]
    fn sprop_stereo_also_aligns_explicit_mono() {
        let input = sdp(
            "a=group:BUNDLE mic share\r\n",
            &[
                audio("mic", "111", Some("sprop-stereo=0;stereo=0;usedtx=1")),
                audio("share", "111", Some("sprop-stereo=1;stereo=1;usedtx=1")),
            ],
        );
        let output = normalize_opus_stereo(&input).unwrap();
        assert_eq!(output.matches("sprop-stereo=1").count(), 2);
        assert_eq!(output.matches(";stereo=1").count(), 2);
        assert!(!output.contains("stereo=0"));
        assert_eq!(output.matches("usedtx=1").count(), 2);
    }

    #[test]
    fn absent_fmtp_is_created_with_the_actual_payload() {
        let input = sdp(
            "a=group:BUNDLE a b\r\n",
            &[audio("a", "109", None), audio("b", "109", Some("stereo=1"))],
        );
        let output = normalize_opus_stereo(&input).unwrap();
        assert_eq!(output.matches("a=fmtp:109 stereo=1\r\n").count(), 2);
        assert!(!output.contains("111"));
    }

    #[test]
    fn independent_groups_payloads_and_video_are_preserved() {
        let independent = [
            audio("c", "111", Some("stereo=0")), audio("d", "111", Some("stereo=0")),
            audio("other", "112", Some("stereo=0")), audio("unbundled", "111", Some("stereo=0")),
            "m=video 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:video\r\na=rtpmap:111 VP8/90000\r\na=fmtp:111 stereo=0\r\n".into(),
        ];
        let mut sections = vec![audio("a", "111", Some("stereo=1")), audio("b", "111", None)];
        sections.extend(independent.clone());
        let input = sdp(
            "a=group:BUNDLE a b other video\r\na=group:BUNDLE c d\r\n",
            &sections,
        );
        let output = normalize_opus_stereo(&input).unwrap();
        assert_eq!(output.matches("a=fmtp:111 stereo=1").count(), 2);
        for section in independent {
            assert!(output.contains(&section));
        }
    }

    #[test]
    fn coherent_mono_stereo_and_non_bundled_sdp_are_unchanged() {
        for params in [
            None,
            Some("minptime=10"),
            Some("stereo=0"),
            Some("stereo=1;sprop-stereo=1"),
        ] {
            let input = sdp(
                "a=group:BUNDLE a b\r\n",
                &[audio("a", "111", params), audio("b", "111", params)],
            );
            assert!(normalize_opus_stereo(&input).is_none());
        }
        let unbundled = sdp(
            "",
            &[audio("a", "111", Some("stereo=1")), audio("b", "111", None)],
        );
        assert!(normalize_opus_stereo(&unbundled).is_none());
    }

    #[test]
    fn exact_parameter_names_case_of_codec_and_line_endings() {
        let input = sdp(
            "a=group:BUNDLE a b\r\n",
            &[
                audio(
                    "a",
                    "111",
                    Some("sprop-stereo=1; stereo = 1;useinbandfec=1"),
                ),
                audio("b", "111", Some("useinbandfec=1")),
            ],
        )
        .replace("opus/", "OPUS/")
        .replace("\r\n", "\n");
        let output = normalize_opus_stereo(&input).unwrap();
        assert!(!output.contains('\r'));
        assert!(output.ends_with('\n'));
        assert!(output.contains("a=fmtp:111 useinbandfec=1;stereo=1;sprop-stereo=1\n"));
        assert!(normalize_opus_stereo(&output).is_none());
    }

    #[test]
    fn explicit_zero_and_absence_have_identical_parameters() {
        let input = sdp(
            "a=group:BUNDLE a b\r\n",
            &[audio("a", "111", Some("stereo=0")), audio("b", "111", None)],
        );
        let output = normalize_opus_stereo(&input).unwrap();
        assert_eq!(output.matches("a=fmtp:111 stereo=0\r\n").count(), 2);
        assert!(normalize_opus_stereo(&output).is_none());
    }

    #[test]
    fn rejected_sections_invalid_flags_and_other_opus_mappings_are_not_changed() {
        let valid = audio("a", "111", None);
        for other in [
            audio("b", "111", Some("stereo=1")).replace("m=audio 9", "m=audio 0"),
            audio("b", "111", Some("stereo=1")).replace("opus/48000/2", "opus/48000/1"),
            audio("b", "111", Some("stereo=2")),
        ] {
            let input = sdp("a=group:BUNDLE a b\r\n", &[valid.clone(), other]);
            assert!(normalize_opus_stereo(&input).is_none());
        }
        let bundle_only = audio("b", "111", Some("stereo=1"))
            .replace("m=audio 9", "m=audio 0")
            .replace("a=mid:b", "a=bundle-only\r\na=mid:b");
        let input = sdp("a=group:BUNDLE a b\r\n", &[valid, bundle_only]);
        assert!(normalize_opus_stereo(&input).is_some());
    }
}
