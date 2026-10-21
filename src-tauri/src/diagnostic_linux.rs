//! Lecture des rapports de notre utilisateur conservés par systemd-coredump.
//! Aucun balayage en arrière-plan ni changement de la politique du système.
use std::fs;
use std::os::unix::fs::{DirBuilderExt, MetadataExt};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub struct Rapport {
    pid: u64,
    pub taille: u64,
}

pub struct RapportsSysteme {
    pub disponible: bool,
    pub rapports: Vec<Rapport>,
    pub erreur: Option<String>,
}

fn commande(arguments: &[&str]) -> Option<std::process::Command> {
    let uid = fs::metadata("/proc/self").ok()?.uid();
    let chemin = std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|dir| dir.join("coredumpctl"))
        .find(|path| path.is_file())?;
    let mut cmd = crate::hidden_command(chemin);
    cmd.env("LC_ALL", "C")
        .env("SYSTEMD_COLORS", "0")
        // L'AppImage embarque ses bibliothèques ; coredumpctl doit charger
        // celles de son système, sans hériter de ces chemins de chargement.
        .env_remove("LD_LIBRARY_PATH")
        .env_remove("LD_PRELOAD")
        .args(["--no-pager", "--since=-14days"])
        .args(arguments)
        .arg(format!("COREDUMP_UID={uid}"))
        .arg("COREDUMP_COMM=sion-client");
    Some(cmd)
}

fn sortie(cmd: &mut std::process::Command, delai: u64) -> Result<std::process::Output, String> {
    crate::process_output::output_with_limits(
        cmd,
        Duration::from_secs(delai),
        &AtomicBool::new(false),
        1024 * 1024,
        4096,
    )
}

pub fn lister() -> RapportsSysteme {
    let mut resultat = RapportsSysteme {
        disponible: false,
        rapports: Vec::new(),
        erreur: None,
    };
    if !fs::read_to_string("/proc/sys/kernel/core_pattern")
        .is_ok_and(|v| v.contains("systemd-coredump"))
    {
        return resultat;
    }
    let Some(mut cmd) = commande(&["--json=short", "--reverse", "-n", "10", "list"]) else {
        return resultat;
    };
    match sortie(&mut cmd, 5) {
        Ok(out) if out.status.success() => {
            match serde_json::from_slice::<Vec<serde_json::Value>>(&out.stdout) {
                Ok(entrees) => {
                    resultat.disponible = true;
                    for entree in entrees {
                        let Some(pid) = entree["pid"].as_u64() else {
                            continue;
                        };
                        if !matches!(
                            entree["corefile"].as_str(),
                            Some("present" | "journal" | "truncated")
                        ) || resultat.rapports.iter().any(|rapport| rapport.pid == pid)
                        {
                            continue;
                        }
                        resultat.rapports.push(Rapport {
                            pid,
                            taille: entree["size"].as_u64().unwrap_or_default(),
                        });
                        if resultat.rapports.len() == 2 {
                            break;
                        }
                    }
                }
                Err(e) => resultat.erreur = Some(format!("Réponse de coredumpctl illisible : {e}")),
            }
        }
        Ok(out) => {
            let message = String::from_utf8_lossy(&out.stderr);
            if message.contains("No coredumps found")
                && !message.contains("Permission denied")
                && !message.contains("Operation not permitted")
            {
                resultat.disponible = true;
            } else {
                resultat.erreur = Some(message.trim().to_string());
            }
        }
        Err(e) => resultat.erreur = Some(e),
    }
    resultat
}

pub struct Copies(pub PathBuf);
impl Drop for Copies {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub fn extraire() -> Result<Copies, String> {
    let rapports = lister();
    if let Some(erreur) = rapports.erreur {
        return Err(erreur);
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let path =
        std::env::temp_dir().join(format!("sion-crash-export-{}-{nonce}", std::process::id()));
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&path)
        .map_err(|e| e.to_string())?;
    let copies = Copies(path);
    for rapport in rapports.rapports {
        let fichier = copies.0.join(format!("sion-client-{}.core", rapport.pid));
        let Some(mut cmd) = commande(&["dump"]) else {
            return Err("coredumpctl n'est plus disponible.".into());
        };
        cmd.arg("--output")
            .arg(&fichier)
            .arg(format!("COREDUMP_PID={}", rapport.pid));
        let out = sortie(&mut cmd, 120)?;
        if !out.status.success() {
            return Err(format!(
                "Extraction du rapport Linux impossible : {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }
    Ok(copies)
}
