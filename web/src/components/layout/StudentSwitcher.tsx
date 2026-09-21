import { useNavigate, useParams } from "react-router-dom";
import { useStudents } from "@/api/queries";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

/** Jump straight to a student without going back through the triage table. */
export function StudentSwitcher() {
  const navigate = useNavigate();
  const params = useParams();
  const { data } = useStudents();
  const current = params.id;

  if (!data?.results.length) return null;

  const currentName = data.results.find(
    (student) => String(student.id) === current,
  )?.name;

  return (
    <Select
      value={current ?? ""}
      onValueChange={(value) => navigate(`/students/${value}`)}
    >
      {/* The trigger renders its own label rather than <SelectValue>, so an
          empty value stays a valid "nothing selected" state on the console. */}
      <SelectTrigger
        size="sm"
        className="w-[184px]"
        aria-label="Open a student's 360 view"
      >
        <span
          className={`truncate ${currentName ? "" : "text-muted-foreground"}`}
        >
          {currentName ?? "Open a student…"}
        </span>
      </SelectTrigger>
      <SelectContent>
        {data.results.map((student) => (
          <SelectItem key={student.id} value={String(student.id)}>
            {student.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
