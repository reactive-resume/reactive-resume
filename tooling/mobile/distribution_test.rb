require "json"
require "tmpdir"
require "yaml"

# Exercise the real lanes at the store SDK boundary without credentials or network calls.
class DistributionContract
  attr_reader :uploads

  def initialize
    @lanes = {}
    @uploads = []
    instance_eval(File.read(File.join(__dir__, "fastlane/Fastfile")), File.join(__dir__, "fastlane/Fastfile"))
  end

  def desc(_description); end

  def platform(name)
    @platform = name
    yield
  end

  def lane(name, &block)
    @lanes[[@platform, name]] = block
  end

  def publish(platform)
    instance_exec(&@lanes.fetch([platform, :upload]))
  end

  def app_store_connect_api_key(**_options)
    { fixture: true }
  end

  def upload_to_play_store(**options)
    # The lane removes its metadata tree after upload, so read the release notes while it exists.
    changelogs = Dir[File.join(options[:metadata_path], "*/changelogs/default.txt")]
      .to_h { |path| [path.split("/")[-3], File.read(path)] }
    @uploads << options.merge(changelogs: changelogs)
  end

  def upload_to_app_store(**options)
    @uploads << options
  end
end

ENV["RUNNER_TEMP"] = Dir.tmpdir
ENV.delete("GOOGLE_PLAY_TRACK")
%w[GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ASC_KEY_ID ASC_ISSUER_ID ASC_PRIVATE_KEY].each { |name| ENV[name] = "fixture" }
contract = DistributionContract.new
contract.publish(:android)
play = contract.uploads.first
raise "Play must upload once" unless contract.uploads.length == 1
raise "Manual Play releases must default to production" unless play[:track] == "production"
raise "Play must submit a full production release for review" unless
  play[:release_status] == "completed" && !play[:changes_not_sent_for_review] &&
    play[:rescue_changes_not_sent_for_review] == false
raise "Play must upload this run's signed artifact to the correct app" unless
  play[:package_name] == "me.rxresu" && play[:aab] == File.join(Dir.tmpdir, "mobile-release/ReactiveResume.aab")
localizations = JSON.parse(File.read(File.join(__dir__, "../../apps/mobile/store/metadata.json"))).fetch("localizations").values
notes = ->(store) { localizations.to_h { |l| [l.fetch(store), l["releaseNotes"].to_s.strip] } }
raise "Every listing locale needs release notes within Play's 500-character limit" if
  localizations.any? { |l| l["releaseNotes"].to_s.strip.empty? || l["releaseNotes"].strip.length > 500 }
raise "Play must send each locale's release notes without the store listing" unless
  play[:changelogs] == notes.call("googleLocale") && play[:skip_upload_changelogs] == false && play[:skip_upload_metadata]

contract.publish(:ios)
app_store = contract.uploads.last
raise "iOS must upload once to the App Store" unless contract.uploads.length == 2
raise "App Store must submit for review and release after approval" unless
  app_store[:submit_for_review] && app_store[:automatic_release] && app_store[:skip_metadata] == false
# Fastlane reads version/build from this IPA to create the version and await the matching processed build.
raise "App Store must upload and select this run's signed artifact" unless
  app_store[:app_identifier] == "me.rxresu" &&
    app_store[:ipa] == File.join(Dir.tmpdir, "mobile-release/ReactiveResume.ipa") &&
    !app_store[:skip_binary_upload] && !app_store[:build_number]
raise "App Store must send each listing locale's release notes" unless app_store[:release_notes] == notes.call("appleLocale")
raise "App Store API-key precheck must exclude unsupported in-app purchase checks" unless
  app_store[:precheck_include_in_app_purchases] == false
ENV["GOOGLE_PLAY_TRACK"] = "internal"
internal = DistributionContract.new
internal.publish(:android)
testing = internal.uploads.fetch(0)
raise "Internal Testing must publish this artifact, not create a draft or promote production" unless
  internal.uploads.length == 1 && testing[:track] == "internal" && testing[:release_status] == "completed" &&
    !testing[:track_promote_to] && testing[:aab] == play[:aab] && testing[:package_name] == play[:package_name] &&
    testing[:changes_not_sent_for_review] == false && testing[:rescue_changes_not_sent_for_review] == false
raise "Internal uploads must preserve listing metadata" unless
  testing[:skip_upload_metadata] && testing[:skip_upload_images] && testing[:skip_upload_screenshots]
ENV["GOOGLE_PLAY_TRACK"] = "untrusted-track"
begin
  internal.publish(:android)
  raise "Invalid track accepted"
rescue RuntimeError => error
  raise unless error.message == "Unsupported Google Play track"
end
raise "Invalid track must not upload" unless internal.uploads.length == 1
ENV.delete("GOOGLE_PLAY_TRACK")
puts "Production and Internal Testing distribution contracts passed"

# The workflow's routing expressions use this shared Ruby/GitHub boolean/property subset.
def workflow_expression(source, event:, platform: "all", format: "store", upload: false,
  ref: "refs/heads/main", failure: false, cancelled: false)
  github = Struct.new(:event_name, :ref).new(event, ref)
  inputs = Struct.new(:platform, :format, :upload).new(platform, format, upload)
  expression = source.strip.delete_prefix("${{").delete_suffix("}}").gsub(/\b(failure|cancelled)\(\)/, '\1')
  eval(expression, binding)
end

workflow = YAML.load_file(File.join(__dir__, "../../.github/workflows/mobile-release.yml"))
events = workflow["on"] || workflow[true] # Psych's YAML 1.1 parser treats `on` as a boolean.
raise "Every main push must trigger release without path filters" unless events.fetch("push") == { "branches" => ["main"] }
raise "Releases must queue rather than cancel pending uploads" unless
  workflow.fetch("concurrency").values_at("group", "cancel-in-progress", "queue") == ["mobile-release", false, "max"]
jobs = workflow.fetch("jobs")
push = { event: "push", platform: nil, format: nil, upload: nil }
dispatch = { event: "workflow_dispatch" }
raise "Push must build only the Kotlin AAB" unless
  workflow_expression(jobs.fetch("build-native").fetch("if"), **push) &&
    !workflow_expression(jobs.fetch("build").fetch("if"), **push) &&
    !workflow_expression(jobs.fetch("preview-native").fetch("if"), **push) &&
    workflow_expression(workflow.fetch("env").fetch("FORMAT"), **push) == "store"
prepare = jobs.fetch("prepare").fetch("steps").find { |step| step["id"] == "release" }.fetch("env")
raise "Push must use the shared native release counter" unless
  workflow_expression(prepare.fetch("PLATFORM"), **push) == "android-native" &&
    workflow_expression(prepare.fetch("UPLOAD"), **push) == "true"
submit = jobs.fetch("submit")
upload_step = submit.fetch("steps").find { |step| step["env"]&.key?("GOOGLE_PLAY_TRACK") }
raise "Every successful push must publish only to Internal Testing" unless
  workflow_expression(submit.fetch("if"), **push) &&
    workflow_expression(upload_step.fetch("env").fetch("GOOGLE_PLAY_TRACK"), **push) == "internal"
raise "Failed or canceled builds must not upload" if
  workflow_expression(submit.fetch("if"), **push, failure: true) ||
    workflow_expression(submit.fetch("if"), **push, cancelled: true)
raise "Manual uploads must remain opt-in production releases" unless
  !workflow_expression(submit.fetch("if"), **dispatch) &&
    workflow_expression(submit.fetch("if"), **dispatch, upload: true) &&
    !workflow_expression(submit.fetch("if"), **dispatch, upload: true, format: "apk") &&
    workflow_expression(upload_step.fetch("env").fetch("GOOGLE_PLAY_TRACK"), **dispatch) == "production"
ci_gate = submit.fetch("steps").find { |step| step["name"]&.include?("successful main CI") }
raise "Manual production must retain its exact-source main-CI gate" unless
  workflow_expression(ci_gate.fetch("if"), **dispatch) && !workflow_expression(ci_gate.fetch("if"), **push)
raise "Untrusted branches must never reach signing or uploads" if
  workflow_expression(jobs.fetch("prepare").fetch("if"), **dispatch, ref: "refs/heads/untrusted")
raise "Native previews must remain available without signing secrets" unless
  workflow_expression(jobs.fetch("prepare").fetch("if"), **dispatch, format: "preview", ref: "refs/heads/preview") &&
    workflow_expression(jobs.fetch("preview-native").fetch("if"), **dispatch, platform: "android-native", format: "preview") &&
    !workflow_expression(jobs.fetch("build-native").fetch("if"), **dispatch, platform: "android-native", format: "preview")
puts "Main-push Internal Testing and manual release workflow routing passed"
