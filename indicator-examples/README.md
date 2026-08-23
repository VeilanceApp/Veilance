# Indicator folder examples

Open Veilance **Settings**, select **Choose indicator folder**, and choose this
directory to load the example JSON rules.

Indicator files are declarative. They can match already-observed API signals or
network host suffixes, but they cannot execute JavaScript or modify websites.

Supported top-level forms:

* One indicator object
* An array of indicator objects
* An object containing an `indicators` array

Signal fields are `indicatorId`, `kind`, `api`, `action`, and `minCount`. Host
rules use `hosts` or the shorthand `hostSuffix`. `mode` may be `any` or `all`.
