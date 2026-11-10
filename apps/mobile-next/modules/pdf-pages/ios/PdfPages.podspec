Pod::Spec.new do |s|
  s.name = 'PdfPages'
  s.version = '0.0.0'
  s.summary = 'On-device PDF page rasterization'
  s.description = s.summary
  s.license = 'MIT'
  s.author = 'Reactive Resume'
  s.homepage = 'https://github.com/reactive-resume/reactive-resume'
  s.platforms = { :ios => '17.4' }
  s.source = { :git => 'https://github.com/reactive-resume/reactive-resume.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.frameworks = 'PDFKit', 'UIKit'
end
