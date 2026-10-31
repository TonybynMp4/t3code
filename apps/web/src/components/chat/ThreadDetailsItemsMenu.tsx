import {
  getClientSettings,
  updateClientSettings,
  useClientSettings,
} from "../../hooks/useSettings";
import { MenuCheckboxItem, MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator } from "../ui/menu";
import {
  isDefaultThreadDetailsVisibility,
  resolveThreadDetailsVisibility,
  resolveThreadHeaderItems,
  RESET_THREAD_DETAILS_ITEMS,
  setThreadDetailsItem,
  setThreadHeaderItem,
  THREAD_DETAILS_ITEMS,
  THREAD_HEADER_ITEMS,
} from "./threadDetailsItems";

/** Menu body that places thread details items. The card, the header, and Settings share it. */
export function ThreadDetailsItemsMenuItems() {
  const visibility = useClientSettings(resolveThreadDetailsVisibility);
  const header = useClientSettings(resolveThreadHeaderItems);
  return (
    <>
      <MenuGroup>
        <MenuGroupLabel>Show in thread details</MenuGroupLabel>
        {THREAD_DETAILS_ITEMS.map((item) => (
          <MenuCheckboxItem
            key={item.id}
            checked={visibility[item.id] && !header[item.id]}
            onCheckedChange={(checked) => {
              const settings = getClientSettings();
              updateClientSettings({
                threadDetailsItems: setThreadDetailsItem(settings, item, checked),
                ...("headerCapable" in item && checked
                  ? { threadHeaderItems: setThreadHeaderItem(settings, item, false) }
                  : {}),
              });
            }}
          >
            {item.label}
          </MenuCheckboxItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup>
        <MenuGroupLabel>Show in header</MenuGroupLabel>
        {THREAD_HEADER_ITEMS.map((item) => (
          <MenuCheckboxItem
            key={item.id}
            checked={header[item.id]}
            onCheckedChange={(checked) =>
              updateClientSettings({
                threadHeaderItems: setThreadHeaderItem(getClientSettings(), item, checked),
              })
            }
          >
            {item.label}
          </MenuCheckboxItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem
        disabled={isDefaultThreadDetailsVisibility(visibility, header)}
        onClick={() => updateClientSettings(RESET_THREAD_DETAILS_ITEMS)}
      >
        Reset to default
      </MenuItem>
    </>
  );
}
