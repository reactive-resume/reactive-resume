require "tmpdir"

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
    raise "Play must upload only to production" unless options[:track] == "production"
    @uploads << options
  end

  def upload_to_app_store(**options)
    @uploads << options
  end
end

ENV["RUNNER_TEMP"] = Dir.tmpdir
%w[GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ASC_KEY_ID ASC_ISSUER_ID ASC_PRIVATE_KEY].each { |name| ENV[name] = "fixture" }
contract = DistributionContract.new
contract.publish(:android)
play = contract.uploads.first
raise "Play must upload once" unless contract.uploads.length == 1
raise "Play must submit a full production release for review" unless
  play[:release_status] == "completed" && !play[:changes_not_sent_for_review] &&
    play[:rescue_changes_not_sent_for_review] == false
raise "Play must upload this run's signed artifact to the correct app" unless
  play[:package_name] == "me.rxresu" && play[:aab] == File.join(Dir.tmpdir, "mobile-release/ReactiveResume.aab")

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
raise "App Store API-key precheck must exclude unsupported in-app purchase checks" unless
  app_store[:precheck_include_in_app_purchases] == false
puts "Production distribution contracts passed"
