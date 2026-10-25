import { TextLink } from "@/components/kit/TextLink";
import { ScreenHeader } from "../ui";

/**
 * Any path the student app does not have — including a console address such
 * as `/students/1`, followed from a link meant for a mentor. It says plainly
 * that the page is not here and offers the way home; it never mounts the
 * console, whose every route is closed to a student account.
 */
export function StudentNotFound() {
  return (
    <>
      <ScreenHeader kicker="Not found" title="This page isn't part of your app.">
        The link may be meant for a teacher&rsquo;s screen, or it may be out of date.
      </ScreenHeader>
      <TextLink to="/">Go to today</TextLink>
    </>
  );
}
