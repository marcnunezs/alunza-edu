"""Offline protocol tests; no guest, Docker daemon or KVM device is started."""
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
import uuid
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("single_launch", Path(__file__).with_name("launch.py"))
launch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launch)


def kit_value():
    return {"sourceDigest": "a" * 64, "sourceCommit": "b" * 40,
            "sourceIdentityMode": "quality-coverage-v1", "bundleManifestSha256": "c" * 64,
            "bundleSha256": "d" * 64, "capsuleImageId": "sha256:" + "e" * 64,
            "runtime": {"runtime": "crun", "runtimeName": "alunza-crun", "runtimeVersion": "1.31",
                        "runtimeSha256": "f" * 64, "runtimePath": "/usr/local/bin/crun", "strategy": "cold"}}


def result(admission):
    return {"event": "result", "bootId": admission["bootId"], "executionId": admission["executionId"],
            "admissions": 1, "caseCount": admission["caseCount"], "mode": admission["mode"],
            "diagnosis": "SUCCESS", "reason": "COMPLETED", "ok": True, "cleanupVerified": True,
            "runtimeMs": 3, "executeMs": 1500,
            "controlsObserved": True, "budgetObserved": True, "imageMatched": True, "limits": launch.LIMITS,
            "outputBytes": 0, "outputTruncated": False, "casesCompleted": admission["caseCount"], "infrastructureStatus": "OK",
            "caseTimings": [{"ordinal": index + 1, "hostStartAttachMs": 20, "containerWallMs": 15,
                             "supervisorProcessMs": 3 / admission["caseCount"], "budgetMs": 3000 - index * 3 / admission["caseCount"], "caseCost": None} for index in range(admission["caseCount"])],
            "phases": [{"phase": "start", "durationMs": 100, "completed": True}]}


def emit(receipt, event):
    return receipt.observe("ALUNZA_SINGLE " + json.dumps(event), 1000)


def catalogue_observations():
    """Generate trusted synthetic observations, never execute the fixture source."""
    program = r'''
const c = require(process.argv[1]);
const leaf = {'memory.max':'134217728','memory.swap.max':'0','cpu.max':'100000 100000','pids.max':'32'};
const outer = {'memory.max':'2147483648','memory.swap.max':'0','cpu.max':'100000 100000'};
const records = c.PROFILE_IDS.map(id => {
  const d = c.describeProfile(id), n = d.caseCount;
  const o = {imageId:c.IMAGE_ID,kernelBoundary:c.BOUNDARY,cleanupVerified:true,
    capsules:Array.from({length:n},(_,i)=>({id:String(i+1).repeat(64),leafBeforeInput:leaf,boundaryBeforeInput:outer})),
    dispatches:Array.from({length:n},(_,i)=>({budgetMs:3000-i*100,outputRemaining:65536}))};
  if(d.kind==='probe') {
    const values = {
      'capsule-identity':{uid:10001,node:'v24.21.0',capabilities:Object.fromEntries(['CapInh','CapPrm','CapEff','CapBnd','CapAmb'].map(k=>[k,'0000000000000000']))},
      'capsule-permissions':{parentDenied:true,readonly:true,environment:['HOME','LANG','PATH']},
      'capsule-network':{loopbackOnly:true,dns:'ENETUNREACH',ipv6:'ENETUNREACH',udp:'ENETUNREACH'},
      'capsule-processes':{uid:10001,attempted:40,started:20,eagain:20,unexpectedErrors:0,pidsMax:32,pidsCurrent:31,identitiesValid:true},
    };
    const oom = d.expectedNativeOutcome==='KERNEL_OOM';
    return c.assessProbe(id,{image:c.IMAGE_ID,kernelBoundary:c.BOUNDARY,cleanupVerified:true,cancelled:false,timedOut:false,
      oomKilled:oom,exitCode:oom?137:0,programWallMs:110,containerWallMs:110,
      packet:oom?null:{status:'exited',exitCode:0,runtimeMs:100,cgroup:leaf,outputBytes:0,outputTruncated:false,
        returnData:Buffer.from(JSON.stringify({kind:'probe',value:values[id]})).toString('base64')}},o);
  }
  const r = {diagnosisCode:d.expectedDiagnosis,terminationReason:d.expectedReason,infrastructureStatus:'OK',
    allRequiredPassed:d.expectedDiagnosis==='SUCCESS',runtimeMs:n*100,outputBytes:0,outputTruncated:false,
    visibleTestResults:Array.from({length:n},()=>({stdout:'',stderr:''})),privateTestResults:[],
    evidence:{image:c.IMAGE_ID,cleanupVerified:true,oomObserved:false,cgroups:Array.from({length:n},()=>leaf),
      timings:Array.from({length:n},(_,i)=>({budgetMs:3000-i*100,supervisorProcessMs:100,hostStartAttachMs:10,containerWallMs:110,watchdog:null}))}};
  if(id.startsWith('output-aggregate-')) {
    const total = {'output-aggregate-below':65535,'output-aggregate-at':65536,'output-aggregate-over':65537}[id];
    r.outputBytes=Math.min(total,65536);r.outputTruncated=total>65536;
    r.visibleTestResults[0].stdout='a'.repeat(32768);r.visibleTestResults[1].stdout='b'.repeat(r.outputBytes-32768);
    o.dispatches[1].outputRemaining=32768;
  }
  if(id==='hidden-projection') {
    r.privateTestResults=[r.visibleTestResults.pop()];o.publicProjection={visibleTestResults:[{}],hiddenChecksPassed:true};
  }
  if(d.expectedDiagnosis==='TIMEOUT') {
    const row=r.evidence.timings[n-1],b=row.budgetMs;row.supervisorProcessMs=b;r.runtimeMs=3000;
    row.watchdog={version:1,clock:'PERFORMANCE_NOW',origin:'BRIDGE_INPUT_PARSED',budgetMs:b,deadlineMs:b,
      launchRequestedMs:0,spawnObservedMs:1,timerArmedMs:2,timerDelayMs:b-2,watchdogFiredMs:b,watchdogLatenessMs:0,
      firstKillAttemptMs:b,lastKillAttemptMs:b,firstKillCallSucceededMs:b,lastKillCallSucceededMs:b,
      exitObservedMs:b,closeObservedMs:b,killAttempts:1,killCallSuccesses:1,lastGuestInstructionObservedMs:null};
  }
  return c.assessRunner(id,r,o);
});
if(records.some(r=>!r.pass)) throw new Error(JSON.stringify(records.filter(r=>!r.pass)));
console.log(JSON.stringify(records));
'''
    portable = Path(__file__).resolve().parents[3] / ".tools/node-v24.21.0-win-x64/node.exe"
    node = str(portable) if sys.platform == "win32" and portable.is_file() else "node"
    return json.loads(subprocess.run([node, "-e", program, str(Path(__file__).with_name("adversarial.cjs"))],
                                    check=True, capture_output=True, text=True, timeout=10).stdout)


class SingleExecutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adversarial_records = catalogue_observations()

    def setUp(self):
        self.admission = launch.request(kit_value(), "SUBMIT", 8, str(uuid.uuid4()), 100000)
        self.receipt = launch.Receipt(self.admission)
        self.ready = {"event": "ready", "bootId": self.admission["bootId"],
                      "executionId": self.admission["executionId"], "sourceDigest": "a" * 64,
                      "runtime": "crun", "runtimeVersion": "1.31", "strategy": "cold", "runnerVersion": "test-only",
                      "nodeVersion": "v24.21.0",
                      "daemonInEnvelope": True, "supervisorInEnvelope": True}

    def test_adversarial_receipt_requires_its_admission_and_honest_gates(self):
        self.admission["fixture"] = "qjs-loop"
        self.admission.update(mode="RUN", caseCount=1)
        emit(self.receipt, self.ready)
        value = {"event": "adversarial-result", "bootId": self.admission["bootId"],
                 "executionId": self.admission["executionId"], "profile": "qjs-loop",
                 "admissions": 1, "mode": "RUN", "caseCount": 1, "ok": False, "executeMs": 4000,
                 "assessment": {"schemaVersion": 1, "profileId": "qjs-loop", "pass": False, "status": "FAILED",
                                "physicalLastInstructionObserved": False, "hostRetirementRequired": True,
                                "latencySample": False, "checks": {"REPORTED_RUNTIME_EXCEEDS_3000": False},
                                "failures": ["REPORTED_RUNTIME_EXCEEDS_3000"]}}
        forged = json.loads(json.dumps(value))
        forged["ok"] = forged["assessment"]["pass"] = True
        forged["assessment"]["status"] = "PASSED"
        with self.assertRaisesRegex(launch.Rejected, "ADVERSARIAL_GATES_REJECTED"):
            emit(self.receipt, forged)
        with self.assertRaisesRegex(launch.Rejected, "EXPECTED_ADVERSARIAL_RECEIPT"):
            emit(self.receipt, result(self.admission))
        emit(self.receipt, value)
        self.assertFalse(self.receipt.result["ok"])
        with self.assertRaises(launch.Rejected):
            emit(self.receipt, value)
        emit(self.receipt, {**self.ready, "event": "clean", "containers": 0})
        self.assertTrue(self.receipt.clean)

    def test_request_has_absolute_creation_deadlines_and_only_fixed_workload(self):
        self.assertEqual(self.admission["normalDeadlineEpochMs"], 130000)
        self.assertEqual(self.admission["cleanupDeadlineEpochMs"], 140000)
        self.assertEqual(self.admission["ttlMs"], 60000)
        self.assertEqual(self.admission["maxAdmissions"], 1)
        self.assertNotIn("code", self.admission)
        for mode, count in (("RUN", 1), ("RUN", 2), ("RUN", 8), ("SUBMIT", 2), ("SUBMIT", 8)):
            self.assertEqual(launch.request(kit_value(), mode, count, str(uuid.uuid4()), 100)["caseCount"], count)
        for mode, count in (("SUBMIT", 1), ("RUN", 0), ("RUN", 50), ("SUBMIT", 51)):
            with self.assertRaisesRegex(launch.Rejected, "WORKLOAD_REJECTED"):
                launch.request(kit_value(), mode, count, str(uuid.uuid4()), 100)

    def test_invalid_adversarial_workload_creates_no_lock_output_or_scratch(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for mode, count, fixture in (("SUBMIT", 2, "qjs-loop"), ("RUN", 8, "capsule-memory"),
                                         ("RUN", 2, "hidden-projection"), ("RUN", 1, "arbitrary-source")):
                with patch.object(launch, "acquire_lock") as lock, patch.object(launch, "verified_kit") as verify, \
                     patch.object(launch.tempfile, "mkdtemp") as scratch, patch.object(launch.subprocess, "Popen") as spawned:
                    with self.assertRaises(launch.Rejected):
                        launch.run(root / "missing-kit", "a" * 64, root / "output", root, mode, count, {}, fixture)
                    for operation in (lock, verify, scratch, spawned):
                        operation.assert_not_called()
                    self.assertEqual(list(root.iterdir()), [])

    def test_all_catalogue_profiles_cross_the_host_projection_without_reclassification(self):
        self.assertEqual({row["profileId"] for row in self.adversarial_records}, set(launch.ADVERSARIAL))
        for row in self.adversarial_records:
            with self.subTest(profile=row["profileId"]):
                self.assertEqual(launch.project_adversarial(row, row["profileId"], True), row)
                expected = launch.adversarial_contract(row["profileId"])
                self.assertEqual(row["expected"], expected)
                admission = launch.request(kit_value(), expected["mode"], expected["caseCount"], str(uuid.uuid4()), 100, row["profileId"])
                self.assertEqual((admission["mode"], admission["caseCount"]), (expected["mode"], expected["caseCount"]))

    def test_adversarial_pass_requires_known_complete_gates_and_observed_controls(self):
        original = next(row for row in self.adversarial_records if row["profileId"] == "qjs-loop")
        for mutation in (lambda row: row.update(checks={"X": True}),
                         lambda row: row["checks"].pop("BEFORE_INPUT_CONTROLS"),
                         lambda row: row["checks"].pop("WATCHDOG_KILL_NOT_OBSERVED"),
                         lambda row: row.update(controlsObserved=False),
                         lambda row: row.update(cleanupVerified=False),
                         lambda row: row.pop("expectedOutcomeObserved"),
                         lambda row: row.update(capsuleCount=0),
                         lambda row: row["result"].update(runtimeMs=3001),
                         lambda row: row["timings"][0].update(budgetMs=3001),
                         lambda row: row["timings"][0]["watchdog"].update(killCallSuccesses=0)):
            row = json.loads(json.dumps(original))
            mutation(row)
            with self.assertRaises(launch.Rejected):
                launch.project_adversarial(row, "qjs-loop", True)

    def test_adversarial_projection_discards_extra_payload_at_every_object_depth(self):
        def poison(value):
            if isinstance(value, dict):
                for key, child in list(value.items()):
                    # Check keys are protocol enum values, not extensible metadata.
                    if key != "checks":
                        poison(child)
                value["privateExpected"] = {"stdout": "NEVER_SERIALIZE_THIS"}
            elif isinstance(value, list):
                for child in value:
                    poison(child)
        for original in self.adversarial_records:
            row = json.loads(json.dumps(original))
            poison(row)
            projected = launch.project_adversarial(row, row["profileId"], True)
            self.assertEqual(projected, original)
            self.assertNotIn("NEVER_SERIALIZE_THIS", json.dumps(projected))

    def test_failed_partial_receipt_preserves_failure_overrun_and_unknown_oom_time(self):
        row = json.loads(json.dumps(next(row for row in self.adversarial_records if row["profileId"] == "qjs-loop")))
        row.update(status="FAILED", **{"pass": False}, withinReportedTimeLimit=False, reportedOverrunMs=17)
        row["result"]["runtimeMs"] = 3017
        row["checks"]["REPORTED_RUNTIME_EXCEEDS_3000"] = False
        row["failures"] = ["REPORTED_RUNTIME_EXCEEDS_3000"]
        projected = launch.project_adversarial(row, "qjs-loop", False)
        self.assertEqual(projected, row)
        partial = {key: row[key] for key in ("schemaVersion", "profileId", "status", "pass", "physicalLastInstructionObserved", "hostRetirementRequired", "latencySample", "checks", "failures")}
        self.assertEqual(launch.project_adversarial(partial, "qjs-loop", False), partial)
        oom = next(row for row in self.adversarial_records if row["profileId"] == "capsule-memory")
        projected_oom = launch.project_adversarial(oom, "capsule-memory", True)
        self.assertIsNone(projected_oom["observedStudentRuntimeMs"])
        self.assertIsNone(projected_oom["withinReportedTimeLimit"])
        self.assertFalse(projected_oom["timingComplete"])
        invented = json.loads(json.dumps(oom))
        invented["observedStudentRuntimeMs"] = 0
        with self.assertRaises(launch.Rejected):
            launch.project_adversarial(invented, "capsule-memory", True)

    def test_adversarial_projection_rejects_strings_in_metrics_and_non_boolean_checks(self):
        for profile, mutate in (("qjs-loop", lambda row: row["timings"][0]["watchdog"].update(closeObservedMs="hidden")),
                                ("capsule-processes", lambda row: row["native"]["processes"].update(started="hidden")),
                                ("capsule-network", lambda row: row["native"]["network"].update(dns="hidden")),
                                ("qjs-loop", lambda row: row["checks"].update(BEFORE_INPUT_CONTROLS=1))):
            row = json.loads(json.dumps(next(row for row in self.adversarial_records if row["profileId"] == profile)))
            mutate(row)
            with self.assertRaises(launch.Rejected):
                launch.project_adversarial(row, profile, True)

    def watchdog_v2_record(self, profile="qjs-loop", close_ms=None):
        row = json.loads(json.dumps(next(item for item in self.adversarial_records if item["profileId"] == profile)))
        timing = row["timings"][-1]
        watch = timing["watchdog"]
        stop = timing["budgetMs"] - 50
        close = stop + 6 if close_ms is None else close_ms
        watch.update(version=2, retirementReserveMs=50, stopDeadlineMs=stop, launchSkipped=False,
                     timerDelayMs=stop - watch["timerArmedMs"], watchdogFiredMs=stop, watchdogLatenessMs=0,
                     firstKillAttemptMs=stop, lastKillAttemptMs=stop, firstKillCallSucceededMs=stop,
                     lastKillCallSucceededMs=stop, exitObservedMs=close - 2, closeObservedMs=close)
        timing["supervisorProcessMs"] = close
        total = sum(item["supervisorProcessMs"] for item in row["timings"])
        row["result"]["runtimeMs"] = row["observedStudentRuntimeMs"] = total
        row["withinReportedTimeLimit"] = total <= 3000
        row["reportedOverrunMs"] = max(0, total - 3000)
        if total > 3000:
            row.update(status="FAILED", **{"pass": False})
            row["checks"]["REPORTED_RUNTIME_EXCEEDS_3000"] = False
            row["failures"] = ["REPORTED_RUNTIME_EXCEEDS_3000"]
        return row

    def test_watchdog_v2_projects_reserve_without_subtracting_it_from_real_runtime(self):
        for profile in ("qjs-loop", "qjs-cumulative-time"):
            with self.subTest(profile=profile):
                row = self.watchdog_v2_record(profile)
                projected = launch.project_adversarial(row, profile, True)
                self.assertEqual(projected, row)
                self.assertEqual(projected["result"]["runtimeMs"], 2956)
                self.assertEqual(sum(item["supervisorProcessMs"] for item in projected["timings"]), 2956)
                watch = projected["timings"][-1]["watchdog"]
                self.assertEqual(watch["deadlineMs"], 3000 if profile == "qjs-loop" else 2900)
                self.assertEqual(watch["closeObservedMs"], watch["stopDeadlineMs"] + 6)
                self.assertIsNone(watch["lastGuestInstructionObservedMs"])

    def test_watchdog_v2_preserves_failed_actual_overrun_without_clipping_or_reclassification(self):
        row = self.watchdog_v2_record(close_ms=3017)
        projected = launch.project_adversarial(row, "qjs-loop", False)
        self.assertEqual(projected, row)
        self.assertEqual(projected["result"]["runtimeMs"], 3017)
        self.assertEqual(projected["reportedOverrunMs"], 17)
        self.assertEqual(projected["failures"], ["REPORTED_RUNTIME_EXCEEDS_3000"])
        self.assertFalse(projected["pass"])

    def test_watchdog_v2_rejects_invalid_schema_and_missing_required_reserve_fields(self):
        mutations = [
            {"version": 3}, {"budgetMs": None}, {"budgetMs": True}, {"budgetMs": 3001},
            {"retirementReserveMs": None}, {"retirementReserveMs": "50"}, {"retirementReserveMs": 49},
            {"retirementReserveMs": 51}, {"stopDeadlineMs": 3000}, {"stopDeadlineMs": None},
            {"launchSkipped": 0}, {"closeObservedMs": "2956"}, {"lastGuestInstructionObservedMs": 2956},
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                row = self.watchdog_v2_record()
                row["timings"][0]["watchdog"].update(mutation)
                with self.assertRaises(launch.Rejected):
                    launch.project_adversarial(row, "qjs-loop", True)
        for missing in ("retirementReserveMs", "stopDeadlineMs", "launchSkipped"):
            row = self.watchdog_v2_record()
            del row["timings"][0]["watchdog"][missing]
            with self.assertRaises(launch.Rejected):
                launch.project_adversarial(row, "qjs-loop", True)

    def test_watchdog_v2_discards_extra_payload_and_v1_keeps_original_semantics(self):
        expected = self.watchdog_v2_record()
        extra = json.loads(json.dumps(expected))
        extra["timings"][0]["watchdog"]["stdout"] = "PRIVATE_UNEXPECTED_VALUE"
        self.assertEqual(launch.project_adversarial(extra, "qjs-loop", True), expected)
        legacy = next(row for row in self.adversarial_records if row["profileId"] == "qjs-loop")
        projected = launch.project_adversarial(legacy, "qjs-loop", True)
        self.assertEqual(projected, legacy)
        self.assertEqual(projected["result"]["runtimeMs"], 3000)
        self.assertNotIn("stopDeadlineMs", projected["timings"][0]["watchdog"])

    def test_runtime_rejects_prepared_or_unpinned_identity(self):
        launch.validate_runtime(kit_value()["runtime"])
        for key, value in (("strategy", "prepared-pair-v1"), ("runtimeSha256", "old"), ("runtimePath", "/tmp/../runtime")):
            with self.assertRaises(launch.Rejected):
                launch.validate_runtime({**kit_value()["runtime"], key: value})

    def test_one_result_only_and_public_receipt_discards_extra_content(self):
        with self.assertRaises(launch.Rejected):
            emit(self.receipt, result(self.admission))
        emit(self.receipt, self.ready)
        with self.assertRaises(launch.Rejected):
            emit(self.receipt, self.ready)
        value = result(self.admission)
        value["privateExpected"] = "NOT_FOR_LOGS"
        public = emit(self.receipt, value)
        self.assertNotIn("NOT_FOR_LOGS", json.dumps(public))
        with self.assertRaisesRegex(launch.Rejected, "SECOND_OR_INVALID_ADMISSION"):
            emit(self.receipt, result(self.admission))
        emit(self.receipt, {**self.ready, "event": "clean", "containers": 0})
        self.assertTrue(self.receipt.clean)

    def test_wrong_guest_and_incomplete_cleanup_are_rejected(self):
        with self.assertRaisesRegex(launch.Rejected, "RECEIPT_OBJECT_REQUIRED"):
            emit(self.receipt, [])
        with self.assertRaisesRegex(launch.Rejected, "RECEIPT_IDENTITY_MISMATCH"):
            emit(self.receipt, {**self.ready, "bootId": str(uuid.uuid4())})
        with self.assertRaisesRegex(launch.Rejected, "CLEANUP_REJECTED"):
            emit(self.receipt, {**self.ready, "event": "clean", "containers": 0})
        emit(self.receipt, self.ready)
        invalid = result(self.admission)
        invalid["phases"][0]["durationMs"] = float("nan")
        with self.assertRaisesRegex(launch.Rejected, "PHASE_REJECTED"):
            emit(self.receipt, invalid)

    def test_qemu_has_two_private_overlays_no_network_and_one_readonly_control_blob(self):
        args = launch.vm_args(Path("/supplied-kit"), self.admission["bootId"])
        self.assertEqual(args[args.index("-accel") + 1], "kvm")
        self.assertEqual(args[args.index("-smp") + 1], "1")
        self.assertEqual(args[args.index("-m") + 1], "2048")
        self.assertEqual(args[args.index("-nic") + 1], "none")
        self.assertEqual(args.count("-drive"), 2)
        self.assertIn("name=opt/alunza/request,file=request.json", args)
        self.assertNotIn("-virtfs", args)
        self.assertNotIn("-netdev", args)
        self.assertIn("systemd.unit=alunza-single.target", args[args.index("-append") + 1])

    def test_success_requires_all_cases_and_fixed_observed_budgets(self):
        for change in ({"runtimeMs": 3000}, {"outputBytes": 65537}, {"limits": {**launch.LIMITS, "runtimeMs": 4000}},
                       {"caseTimings": []}, {"casesCompleted": 7}, {"controlsObserved": False}, {"imageMatched": False},
                       {"outputTruncated": True}, {"diagnosis": "TIMEOUT"}, {"infrastructureStatus": "FAILED"}):
            receipt = launch.Receipt(self.admission)
            emit(receipt, self.ready)
            with self.assertRaises(launch.Rejected):
                emit(receipt, {**result(self.admission), **change})
        receipt = launch.Receipt(self.admission)
        emit(receipt, self.ready)
        failed = {**result(self.admission), "runtimeMs": 3001, "budgetObserved": False, "ok": False,
                  "diagnosis": "TIMEOUT", "reason": "EXECUTION_DEADLINE"}
        self.assertFalse(emit(receipt, failed)["ok"])

    def test_optional_profile_is_redacted_without_changing_diagnosis(self):
        value = result(self.admission)
        value["caseTimings"][0]["caseCost"] = {"version": 1, "workerClock": "PERFORMANCE_NOW",
            "workerOrigin": "NODE_PERFORMANCE_TIME_ORIGIN", "bridgeOrigin": "BRIDGE_INPUT_PARSED", "status": "COMPLETE",
            "phases": [{"phase": "entry", "atMs": 1, "secret": "NOT_FOR_LOGS"}, {"phase": "workerExit", "atMs": 5}],
            "receivedFirstMs": 3, "receivedLastMs": 8, "launchRequestedMs": .5, "closeObservedMs": 10, "secret": "NOT_FOR_LOGS"}
        emit(self.receipt, self.ready)
        saved = emit(self.receipt, value)
        self.assertTrue(saved["ok"])
        self.assertNotIn("NOT_FOR_LOGS", json.dumps(saved))
        self.assertEqual(saved["caseTimings"][0]["caseCost"]["status"], "COMPLETE")
        self.assertEqual(launch.project_case_cost({"status": "COMPLETE", "secret": "NOT_FOR_LOGS"}), {"status": "INVALID"})

    def test_success_rejects_per_case_reset_and_forged_runtime_total(self):
        for reset in (True, False):
            receipt = launch.Receipt(self.admission)
            emit(receipt, self.ready)
            value = result(self.admission)
            if reset:
                for row in value["caseTimings"]:
                    row["budgetMs"] = 3000
            else:
                value["runtimeMs"] = 2
            with self.assertRaisesRegex(launch.Rejected, "CASE_BUDGET_RESET_OR_MISMATCH|ACCUMULATED_RUNTIME_MISMATCH"):
                emit(receipt, value)

    def test_qmp_rejects_wrong_outer_resources_before_cont(self):
        for cpus, memory, valid in ((1, 2147483648, True), (2, 2147483648, False), (1, 4294967296, False)):
            responses = [{"QMP": {}}, {"id": "qmp_capabilities", "return": {}},
                         {"id": "query-kvm", "return": {"enabled": True, "present": True}},
                         {"id": "query-uuid", "return": {"UUID": self.admission["bootId"]}},
                         {"id": "query-status", "return": {"running": False}},
                         {"id": "query-cpus-fast", "return": [{}] * cpus},
                         {"id": "query-memory-size-summary", "return": {"base-memory": memory, "plugged-memory": 0}},
                         {"id": "cont", "return": {}}]
            with patch.object(launch.socket, "AF_UNIX", 1, create=True), patch.object(launch.socket, "socket") as sock, patch.object(launch.time, "monotonic", return_value=5):
                client = sock.return_value.__enter__.return_value
                client.makefile.return_value = io.BytesIO(b"\n".join(json.dumps(row).encode() for row in responses) + b"\n")
                proc = MagicMock()
                proc.poll.return_value = None
                if valid:
                    self.assertTrue(launch.confirm_qmp(Path("/scratch"), proc, self.admission["bootId"], 30)["observedBeforeCont"])
                else:
                    with self.assertRaises(launch.Rejected):
                        launch.confirm_qmp(Path("/scratch"), proc, self.admission["bootId"], 30)
                    self.assertFalse(any(b'"execute": "cont"' in call.args[0] for call in client.sendall.call_args_list))

    def test_absolute_deadline_does_not_restart_at_readiness(self):
        emit(self.receipt, self.ready)
        with patch.object(launch.time, "monotonic", return_value=31), patch.object(launch.selectors, "DefaultSelector"):
            with self.assertRaisesRegex(launch.Rejected, "ABSOLUTE_OPERATION_OR_CLEANUP_DEADLINE"):
                launch.capture(MagicMock(), self.receipt, 0, io.StringIO())

    def test_non_linux_preflight_stops_before_legacy_or_device_checks(self):
        with patch.object(launch.sys, "platform", "win32"), patch.object(launch, "legacy") as previous:
            with self.assertRaisesRegex(launch.Rejected, "LINUX_PHYSICAL_KVM_REQUIRED"):
                launch.host()
            previous.assert_not_called()

    def test_nested_host_is_rejected_before_device_or_guest_access(self):
        native = launch.legacy()
        with patch.object(launch.sys, "platform", "linux"), patch.object(launch, "legacy", return_value=native), \
                patch.object(launch.platform, "machine", return_value="x86_64"), \
                patch.object(native.platform, "system", return_value="Linux"), \
                patch.object(native.platform, "release", return_value="6.8.0-generic"), \
                patch.object(native.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "kvm\n", "")) as command:
            with self.assertRaisesRegex(ValueError, "host virtualization"):
                launch.host()
            self.assertEqual(command.call_count, 1)
            self.assertEqual(command.call_args.args[0], ["systemd-detect-virt"])

    def make_bundle(self, root, name="packages/runner/dist/index.js", member_type=None):
        content = b"export const fixture = true;\n"
        data = {"schemaVersion": 1, "scope": "LOCAL_DOCKER_COLD_ONLY", "sourceDigest": "a" * 64,
                "sourceCommit": "b" * 40, "sourceIdentityMode": "quality-coverage-v1",
                "lockfileSha256": "c" * 64, "runtime": {"node": "v24.21.0", "packageManager": "npm@11.19.0"},
                "inventory": [{"path": "packages/runner/dist/index.js", "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}]}
        (root / "runner-bundle.json").write_text(json.dumps(data))
        with tarfile.open(root / "runner.tar.gz", "w:gz") as archive:
            info = tarfile.TarInfo(name)
            if member_type:
                info.type, info.linkname = member_type, "/private"
                archive.addfile(info)
            else:
                info.size = len(content)
                archive.addfile(info, io.BytesIO(content))

    def test_bundle_rejects_traversal_links_and_changed_hashes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.make_bundle(root)
            self.assertEqual(launch.verify_bundle(root)["sourceDigest"], "a" * 64)
            for name, kind in (("../escape", None), ("packages/runner/dist/index.js", tarfile.SYMTYPE)):
                self.make_bundle(root, name, kind)
                with self.assertRaisesRegex(launch.Rejected, "UNSAFE_TAR_ENTRY"):
                    launch.verify_bundle(root)
            self.make_bundle(root)
            data = json.loads((root / "runner-bundle.json").read_text())
            data["inventory"][0]["sha256"] = "0" * 64
            (root / "runner-bundle.json").write_text(json.dumps(data))
            with self.assertRaisesRegex(launch.Rejected, "BUNDLE_HASH_MISMATCH"):
                launch.verify_bundle(root)

    def test_run_creates_one_vm_and_removes_both_overlays_even_when_guest_fails(self):
        for scenario in ("success", "failure", "signal", "slow-cleanup", "uncertain-cleanup", "guest-cleanup-missing"):
            with tempfile.TemporaryDirectory() as temp:
                root, data = Path(temp), kit_value()
                kit = root / "kit"
                kit.mkdir()
                data.update(schemaVersion=2, scope="LOCAL_SINGLE_EXECUTION", files={})
                for name in launch.ARTIFACTS:
                    (kit / name).write_bytes(b"synthetic-image-not-bootable")
                    data["files"][name] = {"sha256": launch.sha(kit / name), "bytes": (kit / name).stat().st_size}
                (kit / "guest-manifest.json").write_text(json.dumps(data))
                fd = os.open(root / "lock", os.O_RDWR | os.O_CREAT, 0o600)
                proc = MagicMock()
                proc.poll.side_effect = [None, 0]
                proc.wait.return_value = 0
                if scenario == "uncertain-cleanup":
                    proc.wait.side_effect = subprocess.TimeoutExpired("synthetic-qemu", 1)
                proc.pid = 12345
                def fake_capture(_proc, receipt, _created, _events):
                    if scenario == "failure":
                        raise launch.Rejected("ABSOLUTE_OPERATION_OR_CLEANUP_DEADLINE")
                    if scenario == "signal":
                        self.assertIs(launch.signal.getsignal(launch.signal.SIGTERM), launch.stop_requested)
                        launch.stop_requested(launch.signal.SIGTERM, None)
                    receipt.ready, receipt.clean = 10, True
                    receipt.result = result(receipt.admission)
                    if scenario == "guest-cleanup-missing":
                        receipt.clean = False
                        raise launch.Rejected("INCOMPLETE_GUEST_RECEIPT")
                clock = patch.object(launch.time, "monotonic", side_effect=[0, 1, 2, 3, 45, 46, 47, 48]) if scenario == "slow-cleanup" else nullcontext()
                with clock, patch.object(launch.signal, "SIGKILL", 9, create=True), patch.object(launch, "acquire_lock", return_value=fd), patch.object(launch.subprocess, "run") as command, \
                     patch.object(launch.subprocess, "Popen", return_value=proc) as spawned, patch.object(launch, "confirm_qmp", return_value={"vcpu": 1}), \
                     patch.object(launch, "capture", side_effect=fake_capture), patch.object(launch.os, "killpg", create=True) as kill:
                    report = launch.run(kit, launch.sha(kit / "guest-manifest.json"), root / "out", root, "SUBMIT", 8, {"mock": True})
                    self.assertEqual(spawned.call_count, 1)
                    self.assertEqual(command.call_count, 2)
                    self.assertTrue(all(call.args[0][:6] == ["qemu-img", "create", "-q", "-f", "qcow2", "-o"] for call in command.call_args_list))
                    self.assertTrue(report["baseFilesUnchanged"])
                    self.assertEqual(report["status"], "measured" if scenario == "success" else "failed")
                    kill.assert_called_once_with(12345, launch.signal.SIGKILL)
                    if scenario == "uncertain-cleanup":
                        self.assertFalse(report["scratchAbsent"] or report["qemuReaped"])
                        self.assertGreater((root / "lock").stat().st_size, 0)
                    else:
                        self.assertTrue(report["scratchAbsent"] and report["qemuReaped"])
                        self.assertEqual(sorted(path.name for path in root.iterdir()), ["kit", "lock", "out"])
                        self.assertEqual((root / "lock").stat().st_size, 0)
                    if scenario == "slow-cleanup":
                        self.assertTrue(report["withinExternalTtl"])
                        self.assertFalse(report["withinInitialCleanup"])
                    if scenario == "guest-cleanup-missing":
                        self.assertEqual(report["result"]["runtimeMs"], 3)
                        self.assertFalse(report["guestCleanupVerified"])

    def test_persistent_marker_rejects_a_new_guest_after_guardian_loss(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "lock"
            path.write_text("unresolved-owned-guest\n")
            fd = os.open(path, os.O_RDWR)
            duplicate = os.dup(fd)
            try:
                with patch.dict(sys.modules, {"fcntl": MagicMock()}), patch.object(launch.os, "getuid", return_value=os.fstat(fd).st_uid, create=True), \
                     patch.object(launch.os, "O_NOFOLLOW", 0, create=True), patch.object(launch.os, "open", return_value=duplicate):
                    with self.assertRaisesRegex(launch.Rejected, "PREVIOUS_RESOURCES_UNRESOLVED"):
                        launch.acquire_lock()
            finally:
                os.close(fd)


if __name__ == "__main__":
    unittest.main()
