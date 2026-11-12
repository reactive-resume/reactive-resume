require "tmpdir"

# Exercise the real build lane while replacing only Gradle and the Fastlane DSL.
class AndroidBuildContract
  attr_reader :gradle_options, :keystore_path

  def initialize(fastfile = File.join(__dir__, "fastlane/Fastfile"))
    @lanes = {}
    instance_eval(File.read(fastfile), fastfile)
  end

  def desc(_description); end

  def platform(name)
    @platform = name
    yield
  end

  def lane(name, &block)
    @lanes[[@platform, name]] = block
  end

  def build
    instance_exec(&@lanes.fetch([:android, :build]))
  end

  def gradle(**options)
    @gradle_options = options
    @keystore_path = options.fetch(:properties).fetch("android.injected.signing.store.file")
    raise "Missing keystore" unless File.binread(@keystore_path) == "fixture"
    raise "Keystore permissions" unless File.stat(@keystore_path).mode & 0777 == 0600
    File.write(File.join(ENV.fetch("RUNNER_TEMP"), "fixture.aab"), "signed AAB")
  end

  def lane_context
    {
      SharedValues::GRADLE_AAB_OUTPUT_PATH => File.join(ENV.fetch("RUNNER_TEMP"), "fixture.aab")
    }
  end
end

module SharedValues
  GRADLE_AAB_OUTPUT_PATH = :aab
end

module UI
  def self.user_error!(message)
    raise message
  end
end

Dir.mktmpdir do |directory|
  ENV.update(
    "RUNNER_TEMP" => directory,
    "ANDROID_KEYSTORE_BASE64" => "Zml4dHVyZQ==",
    "ANDROID_KEYSTORE_PASSWORD" => "fixture-store",
    "ANDROID_KEY_ALIAS" => "fixture-alias",
    "ANDROID_KEY_PASSWORD" => "fixture-key"
  )
  fastfile = File.join(directory, "tooling/mobile/fastlane/Fastfile")
  FileUtils.mkdir_p(File.dirname(fastfile))
  FileUtils.cp(File.join(__dir__, "fastlane/Fastfile"), fastfile)
  %w[mapping native-debug-symbols].each do |kind|
    path = File.join(directory, "apps/mobile/android/app/build/outputs", kind, "release")
    FileUtils.mkdir_p(path)
    File.write(File.join(path, "fixture"), kind)
  end
  contract = AndroidBuildContract.new(fastfile)
  contract.build
  options = contract.gradle_options
  raise "Wrong Gradle task" unless options[:task] == "bundle"
  raise "R8 disabled" unless options[:properties]["android.enableMinifyInReleaseBuilds"] == "true"
  raise "Resource shrinking disabled" unless options[:properties]["android.enableShrinkResourcesInReleaseBuilds"] == "true"
  raise "Signing command exposed" unless options[:print_command] == false
  raise "Keystore leaked" if File.exist?(contract.keystore_path)
  raise "Wrong artifact" unless File.read(File.join(directory, "mobile-release", "ReactiveResume.aab")) == "signed AAB"
  %w[mapping native-debug-symbols].each do |kind|
    raise "Missing #{kind} archive" unless File.read(File.join(directory, "mobile-release", kind, "fixture")) == kind
  end
end

puts "Android build contract passed: signed store AAB, debug evidence, signing cleanup."
