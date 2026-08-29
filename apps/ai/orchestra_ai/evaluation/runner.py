"""
Evaluation Runner
=================

Runs evaluation cases against the Copilot pipeline and scores results.

Usage:
    runner = EvalRunner(copilot)
    report = await runner.run_all()
    print(report.summary())
"""

from __future__ import annotations

import time
from typing import Any

from pydantic import BaseModel, Field

from orchestra_ai.evaluation.datasets import ALL_EVAL_CASES, EvalCase


class EvalScore(BaseModel):
    """Score for a single evaluation case."""
    case_id: str
    category: str
    passed: bool
    scores: dict[str, float] = Field(default_factory=dict)
    latency_ms: int = 0
    cost_usd: float = 0.0
    error: str | None = None
    notes: str = ""


class EvalReport(BaseModel):
    """Aggregated evaluation report."""
    total: int = 0
    passed: int = 0
    failed: int = 0
    scores: list[EvalScore] = Field(default_factory=list)
    category_scores: dict[str, dict[str, float]] = Field(default_factory=dict)
    overall_accuracy: float = 0.0
    total_cost_usd: float = 0.0
    total_latency_ms: int = 0

    def summary(self) -> str:
        lines = [
            f"═══ Evaluation Report ═══",
            f"Total: {self.total} | Passed: {self.passed} | Failed: {self.failed}",
            f"Overall accuracy: {self.overall_accuracy:.1%}",
            f"Total cost: ${self.total_cost_usd:.4f}",
            f"Total latency: {self.total_latency_ms}ms",
            "",
        ]
        for cat, scores in self.category_scores.items():
            avg = scores.get("accuracy", 0)
            lines.append(f"  {cat}: {avg:.1%} accuracy")
        lines.append("")
        for s in self.scores:
            status = "✓" if s.passed else "✗"
            lines.append(f"  {status} {s.case_id} ({s.category}) — {s.latency_ms}ms")
            if s.error:
                lines.append(f"    Error: {s.error}")
        return "\n".join(lines)


class EvalRunner:
    """
    Runs evaluation cases against the Copilot.

    This is a scaffold — plug in your actual Copilot to run real evaluations.
    """

    def __init__(self, copilot_fn=None):
        """
        Args:
            copilot_fn: An async function that takes a request string and returns
                       a dict with 'graph', 'summary', 'todos', etc.
                       If None, uses a mock for testing the framework.
        """
        self._copilot = copilot_fn

    async def run_all(self, cases: list[EvalCase] | None = None) -> EvalReport:
        """Run all evaluation cases and produce a report."""
        cases = cases or ALL_EVAL_CASES
        report = EvalReport(total=len(cases))

        for case in cases:
            score = await self._run_one(case)
            report.scores.append(score)
            if score.passed:
                report.passed += 1
            else:
                report.failed += 1
            report.total_cost_usd += score.cost_usd
            report.total_latency_ms += score.latency_ms

        # Aggregate by category
        categories: dict[str, list[EvalScore]] = {}
        for s in report.scores:
            categories.setdefault(s.category, []).append(s)

        for cat, scores in categories.items():
            accuracy = sum(1 for s in scores if s.passed) / max(len(scores), 1)
            avg_latency = sum(s.latency_ms for s in scores) / max(len(scores), 1)
            report.category_scores[cat] = {
                "accuracy": accuracy,
                "avg_latency_ms": avg_latency,
                "count": len(scores),
            }

        report.overall_accuracy = report.passed / max(report.total, 1)
        return report

    async def _run_one(self, case: EvalCase) -> EvalScore:
        """Run a single evaluation case."""
        started = time.monotonic()

        try:
            if self._copilot:
                result = await self._copilot(case.request, case.context)
            else:
                result = self._mock_copilot(case)

            latency = int((time.monotonic() - started) * 1000)

            # Score the result
            passed, scores = self._score(case, result)

            return EvalScore(
                case_id=case.id,
                category=case.category,
                passed=passed,
                scores=scores,
                latency_ms=latency,
            )

        except Exception as e:
            latency = int((time.monotonic() - started) * 1000)
            return EvalScore(
                case_id=case.id,
                category=case.category,
                passed=False,
                latency_ms=latency,
                error=str(e)[:200],
            )

    def _score(self, case: EvalCase, result: dict[str, Any]) -> tuple[bool, dict[str, float]]:
        """Score a Copilot result against expected outcomes."""
        expected = case.expected
        scores: dict[str, float] = {}
        all_pass = True

        # Check graph validity
        if "graph_valid" in expected:
            graph = result.get("graph", {})
            nodes = graph.get("nodes", [])
            edges = graph.get("edges", [])
            has_trigger = any(n.get("type") == "trigger" for n in nodes)
            has_edges = len(edges) > 0
            valid = has_trigger and has_edges and len(nodes) >= 2
            scores["graph_valid"] = 1.0 if valid else 0.0
            if not valid and expected["graph_valid"]:
                all_pass = False

        # Check trigger app
        if "trigger_app" in expected:
            graph = result.get("graph", {})
            nodes = graph.get("nodes", [])
            trigger = next((n for n in nodes if n.get("type") == "trigger"), None)
            match = trigger and trigger.get("appSlug") == expected["trigger_app"]
            scores["trigger_app"] = 1.0 if match else 0.0
            if not match:
                all_pass = False

        # Check action apps
        if "action_apps" in expected:
            graph = result.get("graph", {})
            nodes = graph.get("nodes", [])
            action_slugs = {n.get("appSlug") for n in nodes if n.get("type") == "action"}
            expected_apps = set(expected["action_apps"])
            overlap = action_slugs & expected_apps
            scores["action_apps"] = len(overlap) / max(len(expected_apps), 1)
            if scores["action_apps"] < 0.5:
                all_pass = False

        # Check mutation type for edits
        if "mutation_type" in expected:
            patches = result.get("patches", [])
            mutation_types = {p.get("op") for p in patches}
            match = expected["mutation_type"] in mutation_types
            scores["mutation_type"] = 1.0 if match else 0.0
            if not match:
                all_pass = False

        # Check preserves existing
        if expected.get("preserves_existing"):
            context = case.context.get("existing_graph", {})
            original_nodes = {n["id"] for n in context.get("nodes", [])}
            result_nodes = {n["id"] for n in result.get("graph", {}).get("nodes", [])}
            preserved = original_nodes.issubset(result_nodes)
            scores["preserves_existing"] = 1.0 if preserved else 0.0
            if not preserved:
                all_pass = False

        # Check clarification
        if expected.get("asks_clarification"):
            asks = result.get("asks_questions", False) or len(result.get("todos", [])) > 0
            scores["asks_clarification"] = 1.0 if asks else 0.0
            if not asks:
                all_pass = False

        # Check error diagnosis
        if expected.get("diagnoses_error"):
            diagnosed = result.get("diagnosis") is not None or result.get("root_cause") is not None
            scores["diagnoses_error"] = 1.0 if diagnosed else 0.0
            if not diagnosed:
                all_pass = False

        return all_pass, scores

    def _mock_copilot(self, case: EvalCase) -> dict[str, Any]:
        """Mock copilot for testing the evaluation framework."""
        # Simple mock that produces reasonable outputs
        trigger = {"id": "trigger", "type": "trigger", "appSlug": "webhook", "operation": "catch_hook"}
        action = {"id": "action_1", "type": "action", "appSlug": "http", "operation": "request"}

        # Try to extract app names from the request
        text = case.request.lower()
        for app in ["gmail", "slack", "hubspot", "typeform", "stripe", "whatsapp", "sheets", "github"]:
            if app in text:
                trigger["appSlug"] = app
                break

        return {
            "graph": {
                "nodes": [trigger, action],
                "edges": [{"id": "e-trigger-action_1", "source": "trigger", "target": "action_1"}],
            },
            "summary": f"Mock workflow for: {case.request[:50]}",
            "todos": [],
        }
