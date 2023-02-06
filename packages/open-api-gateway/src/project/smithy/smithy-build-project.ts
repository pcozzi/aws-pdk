/*! Copyright [Amazon.com](http://amazon.com/), Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */
import * as path from "path";
import { Project, ProjectOptions, SampleFile } from "projen";
import { SmithyBuild } from "projen/lib/smithy/smithy-build";
import { SampleExecutable } from "./components/sample-executable";
import { SmithyGeneratedOutput } from "./components/smithy-generated-output";
import { SmithyBuildOptions } from "./types";
import { SmithyServiceName } from "../types";

/**
 * Options for a smithy build project
 */
export interface SmithyBuildProjectOptions extends ProjectOptions {
  /**
   * Smithy service name
   */
  readonly serviceName: SmithyServiceName;
  /**
   * Smithy build options
   */
  readonly smithyBuildOptions?: SmithyBuildOptions;
  /**
   * The build output directory, relative to the project outdir
   */
  readonly buildOutputDir: string;
}

/**
 * Creates a project which transforms a Smithy model to OpenAPI
 */
export class SmithyBuildProject extends Project {
  /**
   * Absolute path to the smithy-build.json file
   */
  public smithyBuildConfigPath: string;
  /**
   * Absolute path to the smithy build output
   */
  public smithyBuildOutputPath: string;

  // Store whether we've synthesized the project
  private synthed: boolean = false;

  constructor(options: SmithyBuildProjectOptions) {
    super(options);

    // HACK: remove all components but the ones we are registering - removes .gitignore, tasks, etc since these are
    // unused and a distraction for end-users!
    // @ts-ignore
    this._components = [];

    const samplePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "samples",
      "smithy"
    );

    // Add all the smithy gradle files, which the user is free to edit
    [
      "build.gradle",
      "gradle/wrapper/gradle-wrapper.jar",
      "gradle/wrapper/gradle-wrapper.properties",
    ].forEach((file) => {
      new SampleFile(this, file, {
        sourcePath: path.join(samplePath, file),
      });
    });

    ["gradlew", "gradlew.bat"].forEach((executable) => {
      new SampleExecutable(this, executable, {
        sourcePath: path.join(samplePath, executable),
      });
    });

    new SampleFile(this, "settings.gradle", {
      contents: `rootProject.name = '${this.name.replace(
        /[\/\\:<>"?\*|]/g,
        "-"
      )}'`,
    });

    const { namespace: serviceNamespace, serviceName } = options.serviceName;

    const modelDir = "src/main/smithy";

    // Create the default smithy model
    new SampleFile(this, path.join(modelDir, "main.smithy"), {
      contents: `$version: "2"
namespace ${serviceNamespace}

use aws.protocols#restJson1

/// A sample smithy api
@restJson1
service ${serviceName} {
    version: "1.0"
    operations: [SayHello]
}

@readonly
@http(method: "GET", uri: "/hello")
operation SayHello {
    input: SayHelloInput
    output: SayHelloOutput
    errors: [ApiError]
}

string Name
string Message

@input
structure SayHelloInput {
    @httpQuery("name")
    @required
    name: Name
}

@output
structure SayHelloOutput {
    @required
    message: Message
}

@error("client")
structure ApiError {
    @required
    errorMessage: Message
}
`,
    });

    // Create the smithy build json file
    new SmithyBuild(this, {
      version: "2.0",
      ...options.smithyBuildOptions,
      projections: {
        ...options.smithyBuildOptions?.projections,
        openapi: {
          plugins: {
            openapi: {
              service: `${serviceNamespace}#${serviceName}`,
              // By default, preserve tags in the generated spec, but allow users to explicitly overwrite this
              tags: true,
              ...options.smithyBuildOptions?.projections?.openapi?.plugins
                ?.openapi,
            },
          },
        },
      },
    });

    // SmithyBuild component above always writes to smithy-build.json
    this.smithyBuildConfigPath = path.join(this.outdir, "smithy-build.json");
    this.smithyBuildOutputPath = path.join(this.outdir, options.buildOutputDir);

    new SmithyGeneratedOutput(this, {
      modelPath: path.join(this.outdir, modelDir),
      gradleProjectPath: this.outdir,
      smithyBuildConfigPath: this.smithyBuildConfigPath,
      outputPath: this.smithyBuildOutputPath,
    });
  }

  /**
   * @inheritDoc
   */
  synth() {
    // Save some time by only synthesizing once. We synthesize this project early so that it's available for the parent
    // project's install phase (pre-synth). Projen will call this method again at the usual time to synthesize this,
    // project, at which point we're already done so can skip.
    if (this.synthed) {
      return;
    }
    super.synth();
    this.synthed = true;
  }
}
