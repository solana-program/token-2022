use assert_cmd::cargo::cargo_bin_cmd;

#[test]
fn invalid_config_will_cause_commands_to_fail() {
    let output = cargo_bin_cmd!("spl-token")
        .args(["address", "--config", "~/nonexistent/config.yml"])
        .output()
        .unwrap();
    assert_eq!(
        std::str::from_utf8(&output.stderr).unwrap(),
        "error: Could not find config file `~/nonexistent/config.yml`\n"
    );
    assert_eq!(output.status.code().unwrap(), 1);
    assert!(!output.status.success());
}
