export default function classNames(...values) {
  return values.filter(Boolean).join(" ");
}
