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
          "RuntimeLibrary": 2
        },
        "VCLinkerTool": {
          "AdditionalDependencies": [
            "WindowsApp.lib",
            "runtimeobject.lib"
          ]
        }
      },
      "defines": [
        "_CRT_SECURE_NO_WARNINGS"
      ]
    }
  ]
}
