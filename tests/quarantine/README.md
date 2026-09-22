# Quarantined tests

These suites import modules removed by the reading-model rewrite (the list
executor, reading session, history consumer, navigation coordinator and their
helpers). They cannot load, so they are renamed out of the vitest include
pattern rather than skipped test by test. Each is to be rewritten against the
new owner (`useTimelineReading`, `TimelineList`) or dropped.
