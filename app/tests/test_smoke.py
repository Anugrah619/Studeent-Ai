import pytest

from apps.tenancy.models import Student

from tests import factories as f


@pytest.mark.django_db
def test_factories_build(cohort):
    s = f.make_student(cohort, "Aarav Mehta")
    f.record(s, cohort.chapter("Thermodynamics"), "ccww")
    assert Student.objects.count() == 1
    assert s.attempts.count() == 4
    assert len(cohort.chapters) == 12
