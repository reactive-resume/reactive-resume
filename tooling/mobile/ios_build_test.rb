require "tmpdir"
require "fileutils"

# Execute the real lane against synthetic profile data; never invoke Apple signing or network APIs.
module UI
  def self.user_error!(message); raise message; end
end
module FastlaneCore
  module ProvisioningProfile
    class << self
      attr_accessor :override
      def parse(path)
        bundle = File.basename(path).start_with?("ReactiveResume") ? "me.rxresu" : "me.rxresu.expo-sharing-extension"
        data = {
          "UUID" => "fixture-#{bundle}", "TeamIdentifier" => ["654ASRW868"], "ExpirationDate" => Time.now + 3600,
          "Entitlements" => { "application-identifier" => "654ASRW868.#{bundle}", "com.apple.security.application-groups" => ["group.me.rxresu"] }
        }
        override&.call(bundle, data)
        data
      end
    end
  end
end
class IOSBuildContract
  attr_reader :targets, :export, :installed, :deleted_keychain
  def initialize
    @lanes = {}; @targets = []; @installed = []
    instance_eval(File.read(File.join(__dir__, "fastlane/Fastfile")), File.join(__dir__, "fastlane/Fastfile"))
  end
  def desc(_); end
  def platform(name); @platform = name; yield; end
  def lane(name, &block); @lanes[[@platform, name]] = block; end
  def build; instance_exec(&@lanes.fetch([:ios, :build])); end
  def create_keychain(**_); end
  def delete_keychain(**_); @deleted_keychain = true; end
  def import_certificate(**options)
    raise "Certificate permissions" unless File.stat(options[:certificate_path]).mode & 0777 == 0600
  end
  def install_provisioning_profile(path:)
    raise "Profile permissions" unless File.stat(path).mode & 0777 == 0600
    destination = "#{path}.installed"
    FileUtils.cp(path, destination)
    @installed << destination
    destination
  end
  def update_code_signing_settings(**options); @targets << options; end
  def cocoapods(**_); end
  def build_app(**options); @export = options; end
end
Dir.mktmpdir do |directory|
  ENV.update("RUNNER_TEMP" => directory, "GITHUB_RUN_ID" => "fixture", "GITHUB_RUN_ATTEMPT" => "1",
    "IOS_DISTRIBUTION_P12_BASE64" => "Zml4dHVyZQ==", "IOS_DISTRIBUTION_P12_PASSWORD" => "fixture",
    "IOS_PROVISION_PROFILE_BASE64" => "Zml4dHVyZQ==", "IOS_SHARE_PROVISION_PROFILE_BASE64" => "Zml4dHVyZQ==")
  contract = IOSBuildContract.new
  contract.build
  raise "Missing targets" unless contract.targets.map { |x| x[:targets].first } == ["ReactiveResume", "expo-sharing-extension"]
  raise "Automatic signing" unless contract.targets.all? { |x| !x[:use_automatic_signing] && x[:build_configurations] == ["Release"] }
  expected = { "me.rxresu" => "fixture-me.rxresu", "me.rxresu.expo-sharing-extension" => "fixture-me.rxresu.expo-sharing-extension" }
  raise "Export mapping" unless contract.export[:export_options][:provisioningProfiles] == expected
  raise "Cleanup failed" unless contract.deleted_keychain && contract.installed.none? { |x| File.exist?(x) }
  failures = [
    ["wrong app ID", ->(d) { d["Entitlements"]["application-identifier"] = "654ASRW868.me.rxresu" }],
    ["missing app group", ->(d) { d["Entitlements"].delete("com.apple.security.application-groups") }],
    ["development profile", ->(d) { d["Entitlements"]["get-task-allow"] = true }],
    ["ad hoc profile", ->(d) { d["ProvisionedDevices"] = ["fixture"] }],
    ["wrong team", ->(d) { d["TeamIdentifier"] = ["OTHER"] }],
    ["expired profile", ->(d) { d["ExpirationDate"] = Time.now - 1 }]
  ]
  failures.each do |name, mutate|
    FastlaneCore::ProvisioningProfile.override = ->(bundle, data) { mutate.call(data) if bundle.end_with?("extension") }
    invalid = IOSBuildContract.new
    begin
      invalid.build
      raise "Accepted #{name}"
    rescue RuntimeError => e
      raise if e.message.start_with?("Accepted")
      raise "Archived invalid profile" if invalid.export
      raise "Leaked installed main profile" unless invalid.installed.none? { |x| File.exist?(x) }
      raise "Leaked keychain" unless invalid.deleted_keychain
    end
  end
end
puts "iOS build configuration passed: separate profiles/targets/export map, app-group/team/distribution/expiry rejection, failure cleanup. No signing executed."
