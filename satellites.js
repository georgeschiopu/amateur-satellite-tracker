// Curated list of amateur-radio satellites with their NORAD catalogue IDs.
// IDs are required by the N2YO API. Availability of individual birds changes
// over time (some are decommissioned), so this is a convenience default and
// not an authoritative status list.
const AMSAT_SATELLITES = [
  { id: 25544, name: "ISS (ZARYA)",       band: "145/437", desc: "Crewed space station — FM/APRS/packet" },
  { id: 7530,  name: "AO-7",              band: "145/29",  desc: "Oldest amateur satellite still (sometimes) active" },
  { id: 24278, name: "FO-29 (JAS-2)",     band: "145/435", desc: "Linear transponder" },
  { id: 27607, name: "SO-50",             band: "145/436", desc: "FM repeater, 67 Hz CTCSS" },
  { id: 22825, name: "AO-27",             band: "145/436", desc: "FM repeater" },
  { id: 39444, name: "AO-73 (FUNcube-1)", band: "145/435", desc: "Linear transponder" },
  { id: 40967, name: "AO-85 (Fox-1A)",    band: "145/435", desc: "FM repeater" },
  { id: 43017, name: "AO-91 (Fox-1B)",    band: "145/435", desc: "FM repeater" },
  { id: 43137, name: "AO-92 (Fox-1D)",    band: "145/435", desc: "FM repeater (status varies)" },
  { id: 43700, name: "AO-95 (Fox-1Cliff)",band: "145/435", desc: "FM repeater (status varies)" },
  { id: 40903, name: "XW-2A",             band: "145/435", desc: "CAS-3 series linear/FM" },
  { id: 40906, name: "XW-2B",             band: "145/435", desc: "CAS-3 series linear/FM" },
  { id: 40907, name: "XW-2C",             band: "145/435", desc: "CAS-3 series linear/FM" },
  { id: 40908, name: "XW-2D",             band: "145/435", desc: "CAS-3 series linear/FM" },
  { id: 40909, name: "XW-2E",             band: "145/435", desc: "CAS-3 series linear/FM" },
  { id: 40910, name: "XW-2F",             band: "145/435", desc: "CAS-3 series linear/FM" },
  { id: 42761, name: "CAS-4A",            band: "145/435", desc: "Linear transponder" },
  { id: 42759, name: "CAS-4B",            band: "145/435", desc: "Linear transponder" },
  { id: 41735, name: "CAS-3H (LilacSat-2)",band: "145/437", desc: "FM/APRS" },
  { id: 40931, name: "IO-86 (LAPAN-A2)",  band: "145/435", desc: "FM repeater / APRS" },
  { id: 43678, name: "PO-101 (Diwata-2)", band: "145/437", desc: "APRS digipeater" },
  { id: 44909, name: "RS-44",             band: "145/435", desc: "Linear transponder (long passes)" },
  { id: 43803, name: "JO-97",             band: "145/435", desc: "Linear transponder" },
  { id: 44387, name: "METEOR M2-2",       band: "137",     desc: "Weather / LRPT imagery" },
  { id: 40069, name: "METEOR M2",         band: "137",     desc: "Weather / LRPT imagery" },
  { id: 25338, name: "NOAA 15",           band: "137",     desc: "APT weather imagery" },
  { id: 28654, name: "NOAA 18",           band: "137",     desc: "APT weather imagery" },
  { id: 33591, name: "NOAA 19",           band: "137",     desc: "APT weather imagery" }
];

if (typeof window !== "undefined") {
  window.AMSAT_SATELLITES = AMSAT_SATELLITES;
}
