-- Minimal JSON codec for the harness.
--
-- FiveM ships a `json` global; the simulator has to provide an equivalent. The
-- decoder is not strictly needed to run the collector, but it lets tests assert
-- against the bytes that actually go on the wire rather than against an
-- in-memory table, which is the only way to catch a payload that serialises
-- into something the backend cannot read.
local json = {}

local ESCAPES = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }

local function isArray(t)
  local n = 0
  for k in pairs(t) do
    if type(k) ~= 'number' then return false end
    n = n + 1
  end
  return n == #t
end

local function encode(v)
  local tv = type(v)
  if v == nil then return 'null'
  elseif tv == 'boolean' then return tostring(v)
  elseif tv == 'number' then
    if v ~= v or v == math.huge or v == -math.huge then return 'null' end
    return (math.type(v) == 'integer') and tostring(v) or string.format('%.6g', v)
  elseif tv == 'string' then
    return '"' .. v:gsub('[%c"\\]', function(c) return ESCAPES[c] or string.format('\\u%04x', c:byte()) end) .. '"'
  elseif tv == 'table' then
    local parts = {}
    if isArray(v) then
      for _, item in ipairs(v) do parts[#parts + 1] = encode(item) end
      return '[' .. table.concat(parts, ',') .. ']'
    end
    for k, item in pairs(v) do
      parts[#parts + 1] = encode(tostring(k)) .. ':' .. encode(item)
    end
    table.sort(parts)  -- stable output makes diffs and golden files usable
    return '{' .. table.concat(parts, ',') .. '}'
  end
  error('cannot encode ' .. tv)
end

json.encode = encode

local Parser = {}
Parser.__index = Parser

function Parser:skip()
  local _, e = self.s:find('^[ \n\r\t]+', self.i)
  if e then self.i = e + 1 end
end

function Parser:value()
  self:skip()
  local c = self.s:sub(self.i, self.i)
  if c == '{' then return self:object()
  elseif c == '[' then return self:array()
  elseif c == '"' then return self:str()
  elseif self.s:find('^true', self.i) then self.i = self.i + 4 return true
  elseif self.s:find('^false', self.i) then self.i = self.i + 5 return false
  elseif self.s:find('^null', self.i) then self.i = self.i + 4 return nil
  end
  local num = self.s:match('^-?%d+%.?%d*[eE]?[-+]?%d*', self.i)
  if not num or num == '' then error('bad json at ' .. self.i) end
  self.i = self.i + #num
  return tonumber(num)
end

function Parser:str()
  self.i = self.i + 1
  local out = {}
  while true do
    local c = self.s:sub(self.i, self.i)
    if c == '' then error('unterminated string') end
    if c == '"' then self.i = self.i + 1 break end
    if c == '\\' then
      local n = self.s:sub(self.i + 1, self.i + 1)
      local map = { n = '\n', r = '\r', t = '\t', ['"'] = '"', ['\\'] = '\\', ['/'] = '/' }
      if n == 'u' then
        out[#out + 1] = string.char(tonumber(self.s:sub(self.i + 2, self.i + 5), 16) % 256)
        self.i = self.i + 6
      else
        out[#out + 1] = map[n] or n
        self.i = self.i + 2
      end
    else
      out[#out + 1] = c
      self.i = self.i + 1
    end
  end
  return table.concat(out)
end

function Parser:object()
  self.i = self.i + 1
  local out = {}
  self:skip()
  if self.s:sub(self.i, self.i) == '}' then self.i = self.i + 1 return out end
  while true do
    self:skip()
    local k = self:str()
    self:skip()
    self.i = self.i + 1  -- ':'
    out[k] = self:value()
    self:skip()
    local c = self.s:sub(self.i, self.i)
    self.i = self.i + 1
    if c == '}' then return out end
    if c ~= ',' then error('expected , or } at ' .. self.i) end
  end
end

function Parser:array()
  self.i = self.i + 1
  local out = {}
  self:skip()
  if self.s:sub(self.i, self.i) == ']' then self.i = self.i + 1 return out end
  while true do
    out[#out + 1] = self:value()
    self:skip()
    local c = self.s:sub(self.i, self.i)
    self.i = self.i + 1
    if c == ']' then return out end
    if c ~= ',' then error('expected , or ] at ' .. self.i) end
  end
end

function json.decode(s)
  return setmetatable({ s = s, i = 1 }, Parser):value()
end

return json
