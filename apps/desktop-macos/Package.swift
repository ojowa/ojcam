// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "OjowacamDesktop",
    platforms: [
        .macOS(.v12)
    ],
    products: [
        .executable(
            name: "OjowacamDesktop",
            targets: ["OjowacamDesktop"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/google/WebRTC.git", from: "1.1.0")
    ],
    targets: [
        .executableTarget(
            name: "OjowacamDesktop",
            dependencies: [
                .product(name: "WebRTC", package: "WebRTC")
            ],
            path: "Sources"
        )
    ]
)
