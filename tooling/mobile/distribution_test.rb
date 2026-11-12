require "fileutils"
require "json"
require "tmpdir"
require "yaml"

module UI
  def self.user_error!(message); raise message; end
  def self.message(_message); end
end

# Exercise the real lanes at the store SDK boundary without credentials or network calls.
class DistributionContract
  attr_reader :uploads, :testflight_queries

  def initialize(testflight: {}, play: [])
    @lanes = {}
    @uploads = []
    @testflight_queries = []
    instance_eval(File.read(File.join(__dir__, "fastlane/Fastfile")), File.join(__dir__, "fastlane/Fastfile"))
    # The Fastfile's helper replaces only the Supply client call; its parsing and selection stay under test.
    define_singleton_method(:play_version_codes) { play }
    @testflight = testflight
  end

  def desc(_description); end

  def platform(name)
    @platform = name
    yield
    @platform = nil
  end

  def lane(name, &block)
    @lanes[[@platform, name]] = block
  end

  def run(platform, name, options = {})
    instance_exec(options, &@lanes.fetch([platform, name]))
  end

  def app_store_connect_api_key(**_options)
    { fixture: true }
  end

  def latest_testflight_build_number(**options)
    @testflight_queries << options
    @testflight.fetch(options[:version], options[:initial_build_number])
  end

  def upload_to_play_store(**options)
    # The lane removes its metadata tree after upload, so read the release notes while it exists.
    changelogs = Dir[File.join(options[:metadata_path], "*/changelogs/default.txt")]
      .to_h { |path| [path.split("/")[-3], File.read(path)] }
    @uploads << options.merge(changelogs: changelogs)
  end

  def upload_to_testflight(**options)
    @uploads << options
  end
end

Dir.mktmpdir do |directory|
  ENV["RUNNER_TEMP"] = directory
  output = ENV["GITHUB_OUTPUT"] = File.join(directory, "output")
  %w[GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ASC_KEY_ID ASC_ISSUER_ID ASC_PRIVATE_KEY].each { |name| ENV[name] = "fixture" }

  # Store readings: the highest of this version's and any version's latest TestFlight build, the highest Play code.
  store = DistributionContract.new(testflight: { "1.0.1" => 7, nil => 41 }, play: %w[12 40 9])
  store.run(nil, :store_build_numbers, version: "1.0.1")
  raise "Store readings must be written for the build-number rule" unless File.read(output) == "ios=41\nandroid=40\n"
  raise "TestFlight must be read for this version and overall, defaulting only an empty train to 0" unless
    store.testflight_queries.map { |query| query[:version] } == ["1.0.1", nil] &&
      store.testflight_queries.all? { |query| query[:app_identifier] == "me.rxresu" && query[:initial_build_number] == 0 }
  File.delete(output)
  DistributionContract.new(testflight: { "1.0.1" => 3 }, play: []).run(nil, :store_build_numbers, version: "1.0.1")
  raise "An app with no Play releases reads as 0" unless File.read(output) == "ios=3\nandroid=0\n"
  [{ testflight: { nil => "1.2" } }, { play: ["x"] }].each do |reading|
    FileUtils.rm_f(output)
    begin
      DistributionContract.new(**reading).run(nil, :store_build_numbers, version: "1.0.1")
      raise "Accepted #{reading}"
    rescue RuntimeError => error
      raise if error.message.start_with?("Accepted")
      raise "An unreadable store must not write a number" if File.exist?(output)
    end
  end

  contract = DistributionContract.new
  contract.run(:android, :upload)
  play = contract.uploads.last
  raise "Play must publish this run's bundle to Internal testing only" unless
    play[:package_name] == "me.rxresu" && play[:aab] == File.join(directory, "mobile-release/ReactiveResume.aab") &&
      play[:track] == "internal" && play[:release_status] == "completed" && !play[:track_promote_to] &&
      play[:changes_not_sent_for_review] == false && play[:rescue_changes_not_sent_for_review] == false
  localizations = JSON.parse(File.read(File.join(__dir__, "../../apps/mobile/store/metadata.json"))).fetch("localizations").values
  raise "Every listing locale needs release notes within Play's 500-character limit" if
    localizations.any? { |l| l["releaseNotes"].to_s.strip.empty? || l["releaseNotes"].strip.length > 500 }
  raise "Play must send each locale's release notes and leave the listing alone" unless
    play[:changelogs] == localizations.to_h { |l| [l.fetch("googleLocale"), l["releaseNotes"].strip] } &&
      play[:skip_upload_metadata] && play[:skip_upload_images] && play[:skip_upload_screenshots]

  contract.run(:ios, :upload)
  testflight = contract.uploads.last
  raise "iOS must upload this run's IPA to TestFlight for internal testers and wait for processing" unless
    testflight[:app_identifier] == "me.rxresu" && testflight[:ipa] == File.join(directory, "mobile-release/ReactiveResume.ipa") &&
      testflight[:distribute_external] == false && testflight[:skip_waiting_for_build_processing] == false
end
puts "Store build-number reading, Play Internal testing and TestFlight upload contracts passed"

workflow_file = File.join(__dir__, "../../.github/workflows/mobile-release.yml")
source = File.read(workflow_file)
workflow = YAML.load_file(workflow_file)
events = workflow["on"] || workflow[true] # Psych's YAML 1.1 parser treats `on` as a boolean.
raise "Pushes to main must release when the app's inputs change" unless
  events.fetch("push").fetch("branches") == ["main"] &&
    %w[apps/mobile/** packages/** patches/** pnpm-lock.yaml pnpm-workspace.yaml tooling/mobile/**].all? { |path| events["push"]["paths"].include?(path) }
raise "Releases must queue rather than cancel pending uploads" unless
  workflow.fetch("concurrency").values_at("group", "cancel-in-progress") == ["mobile-release", false]
raise "No EAS, Expo token or OTA in the release" if source.match?(/\beas\b|EXPO_TOKEN|expo-updates|MOBILE_BUILD_NUMBER_BASE/)
jobs = workflow.fetch("jobs")
raise "Unexpected jobs" unless jobs.keys.sort == %w[build forme-build forme-publish prepare upload]
raise "Store numbers and uploads must stay on main" unless
  jobs.fetch("prepare").fetch("if").start_with?("github.ref == 'refs/heads/main' &&") &&
    jobs.fetch("upload").fetch("if") == "github.ref == 'refs/heads/main'"
raise "Uploads must wait for both builds" unless jobs.fetch("upload").fetch("needs") == %w[prepare build]
raise "Builds must use the store-derived number for the production variant" unless
  jobs.fetch("build").fetch("env").values_at("APP_VARIANT", "MOBILE_BUILD_NUMBER") ==
    ["production", "${{ needs.prepare.outputs.build_number }}"]
raise "Releases must not depend on an unreviewed Forme rebuild" if
  [jobs["prepare"], jobs["build"], jobs["upload"]].any? { |job| Array(job["needs"]).any? { |name| name.start_with?("forme") } } ||
    !jobs.fetch("forme-build").fetch("if").include?("workflow_dispatch")
puts "Release workflow routing passed"
