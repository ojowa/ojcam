Pod::Spec.new do |s|
  s.name             = 'OjowacamCamera'
  s.version          = '1.0.0'
  s.summary          = 'iOS native camera and audio capture for Ojowacam'
  s.homepage         = 'https://github.com/ojowacam/ojowacam'
  s.license          = { :type => 'MIT', :file => 'LICENSE' }
  s.author           = { 'Ojowacam Team' => 'team@ojowacam.com' }
  s.source           = { :git => 'https://github.com/ojowacam/ojowacam.git', :tag => s.version.to_s }
  s.ios.deployment_target = '13.0'
  
  s.source_files = 'Sources/**/*.swift'
  s.requires_arc = true
  
  s.dependency 'React-Core'
  s.dependency 'GoogleWebRTC', '~> 1.1'
  
  s.frameworks = 'AVFoundation', 'VideoToolbox', 'WebRTC'
  
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION' => '5.0'
  }
end
