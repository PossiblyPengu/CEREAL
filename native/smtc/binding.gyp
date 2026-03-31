{
  "targets": [
    {
      "target_name": "smtc",
      "sources": [ "smtc.cpp" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalUsingDirectories": [
            "$(WindowsSDKDir)UnionMetadata\\$(PlatformTarget);",
            "$(WindowsSDKDir)References\\Windows.Foundation.FoundationContract\\2.0.0.0;",
            "$(WindowsSDKDir)References\\Windows.Foundation.UniversalApiContract\\3.0.0.0"
          ]
        }
      }
    }
  ]
}
